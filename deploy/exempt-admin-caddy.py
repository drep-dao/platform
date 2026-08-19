#!/usr/bin/env python3
# Upgrade the §26 maintenance matcher so the admin panel + its API + Next assets are NOT gated
# — otherwise enabling maintenance would lock the sysadmin out of the switch-off button.
# Idempotent: only rewrites the single-line form.
import time, shutil, pathlib

CADDY = "/etc/caddy/Caddyfile"
OLD = "\t@maint file /MAINTENANCE\n"
NEW = (
    "\t@maint {\n"
    "\t\tfile /MAINTENANCE\n"
    "\t\tnot path /admin* /api/v1/sysadmin/* /_next/* /favicon.ico /favicon.svg /icons/*\n"
    "\t}\n"
)

text = pathlib.Path(CADDY).read_text()
n = text.count(OLD)
if n:
    shutil.copy(CADDY, f"{CADDY}.bak.exempt.{int(time.time())}")
    pathlib.Path(CADDY).write_text(text.replace(OLD, NEW))
print(f"matchers upgraded: {n}")
