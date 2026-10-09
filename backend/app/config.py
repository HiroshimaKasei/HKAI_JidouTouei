from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

LAN_DEFAULT_HOST = os.getenv("HKAI_HOST", "0.0.0.0")
LAN_DEFAULT_PORT = int(os.getenv("HKAI_PORT", str(DEFAULT_PORT)))

TRUSTED_LAN_CIDRS = [
	cidr.strip()
	for cidr in os.getenv(
		"HKAI_TRUSTED_LAN_CIDRS",
		"127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
	).split(",")
	if cidr.strip()
]

OPERATOR_LOCK_TTL_SECONDS = int(os.getenv("HKAI_OPERATOR_LOCK_TTL_SECONDS", "300"))
