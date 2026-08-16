"""One-off script: delete team_a from Supabase rescue_teams table."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import config
from urllib.request import urlopen, Request
from urllib.parse import quote

TEAM_ID = "team_a"   # change this if needed

url = config.SUPABASE_URL.rstrip("/")
key  = config.SUPABASE_API_KEY
table = config.SUPABASE_RESCUE_TEAMS_TABLE

if not url or not key:
    print("ERROR: SUPABASE_URL or SUPABASE_API_KEY not set in config / env")
    sys.exit(1)

tid = quote(TEAM_ID, safe="")
path = f"/rest/v1/{table}?team_id=eq.{tid}"
req = Request(
    url + path,
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "return=minimal",
    },
    method="DELETE",
)
try:
    with urlopen(req, timeout=10) as resp:
        print(f"[OK] Deleted '{TEAM_ID}' — HTTP {resp.status}")
except Exception as e:
    print(f"[FAIL] {e}")
