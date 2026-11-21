# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""命令注册表：command -> run(ctx, args)。"""

from __future__ import annotations

from . import (
    approve,
    check,
    close,
    comment,
    commit,
    config as config_cmd,
    create,
    delete,
    doctor,
    init,
    list as list_cmd,
    log,
    merge,
    move,
    open as open_cmd,
    pr,
    rebase,
    reject,
    release,
    remind,
    remove,
    reset,
    restore,
    status,
    switch,
    sync,
    transfer,
    view,
    whoami,
)

HANDLERS = {
    "create": create.run,
    "open": open_cmd.run,
    "commit": commit.run,
    "close": close.run,
    "pr": pr.run,
    "list": list_cmd.run,
    "approve": approve.run,
    "reject": reject.run,
    "comment": comment.run,
    "remove": remove.run,
    "restore": restore.run,
    "reset": reset.run,
    "rebase": rebase.run,
    "check": check.run,
    "status": status.run,
    "view": view.run,
    "remind": remind.run,
    "transfer": transfer.run,
    "delete": delete.run,
    "switch": switch.run,
    "move": move.run,
    "release": release.run,
    "merge": merge.run,
    "init": init.run,
    "sync": sync.run,
    "log": log.run,
    "whoami": whoami.run,
    "doctor": doctor.run,
    "config": config_cmd.run,
}
