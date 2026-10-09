from __future__ import annotations

import socket

import uvicorn

from app.config import DEFAULT_HOST, DEFAULT_PORT, LAN_DEFAULT_HOST, LAN_DEFAULT_PORT


def _local_ipv4_addresses() -> list[str]:
    names = {socket.gethostname(), "localhost"}
    ips: set[str] = set()
    for name in names:
        try:
            for info in socket.getaddrinfo(name, None, family=socket.AF_INET, type=socket.SOCK_STREAM):
                ip = info[4][0]
                if ip and not ip.startswith("127."):
                    ips.add(ip)
        except OSError:
            continue
    return sorted(ips)


def print_access_urls(host: str, port: int) -> None:
    if host in {"127.0.0.1", "localhost"}:
        print(f"HKAI server URL: http://127.0.0.1:{port}")
        return

    print(f"HKAI local URL: http://127.0.0.1:{port}")
    ips = _local_ipv4_addresses()
    if not ips:
        print("HKAI LAN URL: Unable to detect LAN IPv4 automatically.")
        return
    print("HKAI LAN URLs:")
    for ip in ips:
        print(f"  http://{ip}:{port}")


def main() -> None:
    host = LAN_DEFAULT_HOST
    port = LAN_DEFAULT_PORT

    # For development script compatibility, allow opting into localhost defaults.
    if host == "":
        host = DEFAULT_HOST
    if port <= 0:
        port = DEFAULT_PORT

    print_access_urls(host, port)
    uvicorn.run("app.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
