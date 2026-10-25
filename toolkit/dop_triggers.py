"""Multi-subject Differential Output Preservation captions.

Plain DOP swaps one trigger word for one class word. A LoRA of several people
needs every trigger in a caption swapped for its own class ("j@cid" -> "a man",
"l3xi" -> "a woman"), including captions that name two people at once.

The swap is adapted from Fizgig's multi_person.dop_caption
(https://github.com/shootthesound/Fizgig, Copyright 2026 Peter Neill, Apache-2.0).
"""

import re
from typing import List, Optional, Tuple, Union

DopTriggers = List[Tuple[str, str]]


def parse_dop_triggers(value: Union[None, str, dict, list]) -> DopTriggers:
    """[(trigger, class), ...] from a dict {trigger: class}, a list of
    [trigger, class] pairs, or a string "j@cid=a man, l3xi=a woman".
    Longest triggers first so one that contains another is swapped whole."""
    if not value:
        return []
    pairs: DopTriggers = []
    if isinstance(value, dict):
        pairs = [(str(k), str(v)) for k, v in value.items()]
    elif isinstance(value, str):
        for part in value.split(','):
            if not part.strip():
                continue
            if '=' not in part:
                raise ValueError(
                    f"diff_output_preservation_triggers: '{part.strip()}' needs a class, e.g. 'j@cid=a man'"
                )
            trigger, cls = part.split('=', 1)
            pairs.append((trigger, cls))
    else:
        for item in value:
            trigger, cls = item
            pairs.append((str(trigger), str(cls)))
    pairs = [(t.strip(), c.strip()) for t, c in pairs if t.strip()]
    return sorted(pairs, key=lambda p: len(p[0]), reverse=True)


def swap_dop_triggers(caption: Optional[str], pairs: DopTriggers) -> Optional[str]:
    """The caption with every trigger swapped for its class (dropped when the
    class is empty). Captions with none of the triggers come back unchanged, so
    their DOP embedding hashes to the normal one."""
    if not caption or not pairs:
        return caption
    out = caption
    for trigger, cls in pairs:
        pattern = re.compile(r"(?<!\w)" + re.escape(trigger) + r"(?!\w)", re.I)
        out = pattern.sub(lambda _m, c=cls: c, out)
    if out == caption:
        return caption
    # a dropped trigger leaves ", ," or a stray comma behind
    out = re.sub(r"\s*,\s*(?:,\s*)+", ", ", out)
    out = re.sub(r"^\s*,\s*|\s*,\s*$", "", out)
    return re.sub(r"\s{2,}", " ", out).strip()
