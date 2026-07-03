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
            assignment.append(dev)
            idx += 1
    return assignment


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
