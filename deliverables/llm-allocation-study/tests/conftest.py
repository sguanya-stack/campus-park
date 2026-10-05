"""Shared fixtures. No test in this suite may make a network call."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness.data_loader import load_spots  # noqa: E402
from harness.scenario import generate_requests  # noqa: E402


@pytest.fixture(scope="session")
def spots():
    return load_spots()


@pytest.fixture(scope="session")
def small_spots():
    return load_spots(target_total_capacity=30)


@pytest.fixture
def requests_small(small_spots):
    return generate_requests(small_spots, rho=1.2, seed=1)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Hard guard: fail loudly if any test tries to open a socket.

    The whole suite is meant to run in CI with no API key and no egress.
    A test that silently starts calling the real API would cost money on
    every push, so make that impossible rather than merely discouraged.
    """
    import socket

    real = socket.socket.connect

    def blocked(self, addr, *a, **kw):
        host = addr[0] if isinstance(addr, tuple) else addr
        if host in ("127.0.0.1", "::1", "localhost"):
            return real(self, addr, *a, **kw)
        raise AssertionError(f"Test attempted a network connection to {addr!r}")

    monkeypatch.setattr(socket.socket, "connect", blocked)
