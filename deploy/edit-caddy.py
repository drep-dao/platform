#!/usr/bin/env python3
# Insert the §26 maintenance gate into the drepcouncil.org (mainnet) and
# preprod.drepcouncil.org (preprod) blocks of the Caddyfile. Idempotent.
import re, sys, time, shutil, pathlib

CADDY = "/etc/caddy/Caddyfile"
BLOCKS = {"drepcouncil.org {": "/opt/drepdao-main", "preprod.drepcouncil.org {": "/opt/drepdao-gov"}

def snippet(d):
    return (
        f"\troot * {d}\n\n"
        "\t# §26 — maintenance gate: while $DIR/MAINTENANCE exists, everyone gets the\n"
        "\t# \"Short maintenance mode\" page (503). Toggled by deploy-guard.sh; checked per\n"
        "\t# request, so no Caddy reload is needed. Localhost smoke-tests bypass this.\n"
        "\t@maint file /MAINTENANCE\n"
        "\thandle @maint {\n"
        "\t\trewrite * /maintenance.html\n"
        "\t\tfile_server {\n"
        "\t\t\tstatus 503\n"
        "\t\t}\n"
        "\t}\n"
    ).replace("$DIR", d)

text = pathlib.Path(CADDY).read_text()
lines = text.split("\n")
out = []
i = 0
changed = 0
while i < len(lines):
    ln = lines[i]
    out.append(ln)
    header = ln.strip()
    if header in BLOCKS:
        d = BLOCKS[header]
        # look ahead: skip if this block already has the gate
        # find the block end (matching closing brace at column 0)
        j = i + 1
        depth = 1
        block = []
        while j < len(lines) and depth > 0:
            if lines[j].startswith("}"):
                depth -= 1
                if depth == 0:
                    break
            block.append(lines[j]); j += 1
        already = any("@maint" in b for b in block)
        # append the encode line (expected next), then insert snippet after it
        if not already:
            # emit lines until we pass "encode zstd gzip", inserting snippet right after
            k = i + 1
            inserted = False
            while k < j:
                out.append(lines[k])
                if not inserted and lines[k].strip() == "encode zstd gzip":
                    out.append(snippet(d).rstrip("\n"))
                    inserted = True
                k += 1
            if not inserted:  # no encode line found — insert right after header
                out.insert(len(out) - (j - (i + 1)), snippet(d).rstrip("\n"))
            i = j
            changed += 1
            continue
    i += 1

if changed:
    shutil.copy(CADDY, f"{CADDY}.bak.maint.{int(time.time())}")
    pathlib.Path(CADDY).write_text("\n".join(out))
print(f"blocks updated: {changed}")
