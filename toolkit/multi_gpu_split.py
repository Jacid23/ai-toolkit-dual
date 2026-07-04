"""Single-process multi-GPU block splitting (dual-GPU build).

Splits a transformer's block stack across the visible CUDA devices so
full-precision (BF16/FP16) models that do not fit on one GPU can train
without quantization. There is no torch.distributed / NCCL involved — this
is plain device placement plus forward pre-hooks that ferry inputs to each
block's device, which works on native Windows and does not need P2P: the
only recurring transfer is the hidden-state tensor at each device boundary
plus the shared side inputs (time vec, rope freqs, attention mask) once per
step, since a `.to()` onto the tensor's own device is a no-op.

This pools memory rather than adding speed — the devices take turns, they do
not run concurrently.

Usage (see krea2's ``load_model`` for the reference integration):
  - keep the input-side / output-side modules on the main device,
  - ``split_blocks(model.blocks, devices, balance)``,
  - ``attach_input_mover(model.<final layer>, main_device)`` so activations
    return to the main device and the forward's output lands where the
    trainer expects it,
  - after any LoRA network is applied to the model,
    ``place_lora_modules_by_org_device(network)``.
"""

from typing import List, Union

import torch
import torch.nn as nn


def _move_to_device(obj, device: torch.device):
    if torch.is_tensor(obj):
        return obj if obj.device == device else obj.to(device)
    if isinstance(obj, tuple):
        return tuple(_move_to_device(o, device) for o in obj)
    if isinstance(obj, list):
        return [_move_to_device(o, device) for o in obj]
    if isinstance(obj, dict):
        return {k: _move_to_device(v, device) for k, v in obj.items()}
    return obj


def attach_input_mover(module: nn.Module, device: torch.device):
    """Register a pre-hook that moves every tensor input to ``device``.

    Fires inside ``torch.utils.checkpoint`` recompute as well, so gradient
    checkpointing needs no special handling.
    """
    device = torch.device(device)

    def hook(mod, args, kwargs):
        return _move_to_device(args, device), _move_to_device(kwargs, device)

    module.register_forward_pre_hook(hook, with_kwargs=True)


def visible_cuda_devices() -> List[torch.device]:
    return [torch.device(f"cuda:{i}") for i in range(torch.cuda.device_count())]


def validate_split_config(model_config):
    """Reject config combinations that fight the split. Call at the top of an
    arch's ``load_model`` when ``model_config.multi_gpu_split`` is set."""
    if model_config.quantize:
        raise ValueError(
            "multi_gpu_split trains the transformer in full precision - remove quantize"
        )
    if model_config.layer_offloading:
        raise ValueError(
            "multi_gpu_split and layer_offloading cannot be combined - remove one"
        )
    if model_config.low_vram:
        raise ValueError(
            "multi_gpu_split and low_vram cannot be combined - remove low_vram"
        )
    if torch.cuda.device_count() < 2:
        raise ValueError(
            f"multi_gpu_split needs at least 2 visible CUDA devices, found "
            f"{torch.cuda.device_count()}. Start the job with gpu_ids '0,1'."
        )


def place_non_split_modules(model: nn.Module, exclude_children: List[str], device, dtype: torch.dtype = None):
    """Move every direct child of ``model`` except ``exclude_children`` (the
    block lists) to ``device`` - plus root-level parameters and buffers, which
    ``named_children`` misses (e.g. LTX2's ``scale_shift_table``)."""
    device = torch.device(device)
    for name, child in model.named_children():
        if name in exclude_children:
            continue
        if dtype is not None:
            child.to(device, dtype=dtype)
        else:
            child.to(device)
    for name, p in list(model.named_parameters(recurse=False)):
        if dtype is not None and p.is_floating_point():
            p.data = p.data.to(device, dtype)
        else:
            p.data = p.data.to(device)
    for name, b in list(model.named_buffers(recurse=False)):
        if dtype is not None and b.is_floating_point():
            model._buffers[name] = b.to(device, dtype)
        else:
            model._buffers[name] = b.to(device)


def split_block_lists(
    block_lists: List[nn.ModuleList],
    devices: List[Union[str, torch.device]],
    balance: float = 0.4,
    dtype: torch.dtype = None,
) -> List[torch.device]:
    """Like ``split_blocks`` but for archs whose blocks live in several
    sequential ModuleLists of different widths (e.g. FLUX-style
    ``double_blocks`` + ``single_blocks``).

    The lists are treated as one flat sequence in data-flow order and split by
    cumulative *parameter count* (not block count), so a device boundary lands
    at the ``balance`` fraction of the weights regardless of how uneven the
    block sizes are. Assignment is monotonic - one boundary crossing per extra
    device. Returns the flat per-block device assignment.
    """
    devices = [torch.device(d) for d in devices]
    if len(devices) < 2:
        raise ValueError("split_block_lists needs at least 2 devices")
    all_blocks = [b for lst in block_lists for b in lst]
    sizes = [sum(p.numel() for p in b.parameters()) for b in all_blocks]
    total = float(sum(sizes))

    if len(devices) == 2:
        fractions = [balance, 1.0 - balance]
    else:
        rest = (1.0 - balance) / (len(devices) - 1)
        fractions = [balance] + [rest] * (len(devices) - 1)

    assignment: List[torch.device] = []
    device_idx = 0
    cumulative = 0.0
    boundary = fractions[0] * total
    for block, size in zip(all_blocks, sizes):
        # move to the next device once this block's midpoint crosses the
        # boundary, but never strand a later device with zero blocks
        remaining = len(all_blocks) - len(assignment)
        devices_left = len(devices) - device_idx - 1
        if (
            device_idx < len(devices) - 1
            and cumulative + size / 2 > boundary
            and len(assignment) > 0
        ) or remaining == devices_left:
            device_idx += 1
            boundary += fractions[device_idx] * total
        dev = devices[device_idx]
        if dtype is not None:
            block.to(dev, dtype=dtype)
        else:
            block.to(dev)
        attach_input_mover(block, dev)
        block._mgs_device = dev
        assignment.append(dev)
        cumulative += size
    return assignment


def split_blocks(
    blocks: nn.ModuleList,
    devices: List[Union[str, torch.device]],
    balance: float = 0.5,
    dtype: torch.dtype = None,
) -> List[torch.device]:
    """Assign a ModuleList of uniform blocks across ``devices`` and hook each
    one so its inputs follow it.

    ``balance`` is the fraction of blocks on ``devices[0]`` (two-device case;
    more devices get an even split). Keep it below 0.5 when the main device
    also hosts the embedders, optimizer state and sampling buffers. Blocks are
    moved one at a time, so the full model never has to fit on a single GPU
    (weights are expected to still be on CPU from ``assign=True`` loading).

    Returns the per-block device assignment.
    """
    devices = [torch.device(d) for d in devices]
    n = len(blocks)
    if len(devices) < 2:
        raise ValueError("split_blocks needs at least 2 devices")
    if len(devices) == 2:
        k = min(n - 1, max(1, round(n * balance)))
        counts = [k, n - k]
    else:
        base, rem = divmod(n, len(devices))
        counts = [base + (1 if i < rem else 0) for i in range(len(devices))]

    assignment: List[torch.device] = []
    idx = 0
    for dev, count in zip(devices, counts):
        for _ in range(count):
            block = blocks[idx]
            if dtype is not None:
                block.to(dev, dtype=dtype)
            else:
                block.to(dev)
            attach_input_mover(block, dev)
            block._mgs_device = dev
            assignment.append(dev)
            idx += 1
    return assignment


def restore_split_placement(root: nn.Module, main_device, dtype: torch.dtype = None):
    """Re-place a previously split model after a wholesale offload (the
    caching presets legitimately move the whole model to CPU to make room for
    the text encoder). Split blocks carry a ``_mgs_device`` tag from
    ``split_blocks``/``split_block_lists``; everything untagged goes to
    ``main_device``. Moves module-by-module so the full model never has to fit
    on one GPU."""
    main_device = torch.device(main_device)
    tagged_lists = []
    for name, child in root.named_children():
        if isinstance(child, nn.ModuleList) and any(
            hasattr(b, "_mgs_device") for b in child
        ):
            tagged_lists.append(name)
            for block in child:
                block.to(getattr(block, "_mgs_device", main_device))
        else:
            if dtype is not None:
                child.to(main_device, dtype=dtype)
            else:
                child.to(main_device)
    # root-level params/buffers
    for name, p in list(root.named_parameters(recurse=False)):
        p.data = p.data.to(main_device)
    for name, b in list(root.named_buffers(recurse=False)):
        root._buffers[name] = b.to(main_device)


def is_split_model(root: nn.Module) -> bool:
    """True if this model's blocks were placed by the splitter."""
    return any(hasattr(m, "_mgs_device") for m in root.modules())


def place_lora_modules_by_org_device(network) -> int:
    """Move each LoRA module of ``network`` to the device of the module it
    wraps.

    Networks are ``force_to``'d to the main device wholesale; after a block
    split the wrapped Linears live on several devices and each LoRA module
    must follow its own. Returns how many modules were moved.
    """
    moved = 0
    for lora in network.get_all_modules():
        org = getattr(lora, "org_module", None)
        if not org:
            continue
        try:
            dev = next(org[0].parameters()).device
        except StopIteration:
            continue
        if any(p.device != dev for p in lora.parameters()):
            lora.to(dev)
            moved += 1
    return moved
