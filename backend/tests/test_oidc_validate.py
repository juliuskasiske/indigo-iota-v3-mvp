"""Unit tests for ID-token validation (the SSO trust boundary).

validate_id_token is what stops a forged or stale sign-in from being accepted.
We don't call Microsoft: we mint our OWN RSA keypair, sign test tokens with it,
and stand in for Microsoft's published key (the JWKS) and discovery document.
Then we assert a genuine token is accepted and that every tampered variant is
rejected:

  * good token            -> accepted, claims returned
  * expired               -> rejected
  * wrong audience        -> rejected (token minted for a different app)
  * forged signature      -> rejected (signed by a different key)
  * nonce mismatch        -> rejected (replay guard)

No network — discovery and JWKS lookup are monkeypatched.
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from src.auth import oidc
from src.auth.oidc import OidcConfig

ISSUER = "https://login.microsoftonline.com/tenant-123/v2.0"
CLIENT_ID = "login-app-client-id"
NONCE = "the-nonce-we-sent"


def _gen_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return key, priv_pem


@pytest.fixture
def signing(monkeypatch):
    """Mint a keypair and make oidc validate against ITS public key, offline."""
    key, priv_pem = _gen_key()
    pub_key = key.public_key()

    monkeypatch.setattr(
        oidc, "discover", lambda tenant_id: {"issuer": ISSUER, "jwks_uri": "https://jwks.test"}
    )

    class FakeSigningKey:
        def __init__(self, k):
            self.key = k

    class FakeJwksClient:
        def get_signing_key_from_jwt(self, token):
            return FakeSigningKey(pub_key)

    monkeypatch.setattr(oidc, "_jwks_client", lambda uri: FakeJwksClient())
    return priv_pem


@pytest.fixture
def cfg():
    return OidcConfig(
        tenant_id="tenant-123", client_id=CLIENT_ID, client_secret=None, redirect_uri="https://app/cb"
    )


def _mint(priv_pem, *, aud=CLIENT_ID, iss=ISSUER, nonce=NONCE, exp_delta=600):
    now = int(time.time())
    claims = {
        "iss": iss,
        "aud": aud,
        "iat": now,
        "exp": now + exp_delta,
        "nonce": nonce,
        "sub": "user-abc",
        "email": "user@acme.com",
    }
    return jwt.encode(claims, priv_pem, algorithm="RS256")


def test_good_token_is_accepted(signing, cfg):
    token = _mint(signing)
    claims = oidc.validate_id_token(cfg, id_token=token, nonce=NONCE)
    assert claims["sub"] == "user-abc"
    assert claims["email"] == "user@acme.com"


def test_expired_token_is_rejected(signing, cfg):
    token = _mint(signing, exp_delta=-60)  # already expired
    with pytest.raises(jwt.InvalidTokenError):
        oidc.validate_id_token(cfg, id_token=token, nonce=NONCE)


def test_wrong_audience_is_rejected(signing, cfg):
    token = _mint(signing, aud="some-other-app")
    with pytest.raises(jwt.InvalidTokenError):
        oidc.validate_id_token(cfg, id_token=token, nonce=NONCE)


def test_forged_signature_is_rejected(signing, cfg):
    # Sign with a DIFFERENT key than the one validation trusts.
    _other_key, other_pem = _gen_key()
    token = _mint(other_pem)
    with pytest.raises(jwt.InvalidTokenError):
        oidc.validate_id_token(cfg, id_token=token, nonce=NONCE)


def test_nonce_mismatch_is_rejected(signing, cfg):
    token = _mint(signing, nonce="a-different-nonce")
    with pytest.raises(ValueError):
        oidc.validate_id_token(cfg, id_token=token, nonce=NONCE)
