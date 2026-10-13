# Metadata Sovereignty

## Status

The metadata-scrubbing module exists as a library component, but the full import-audit and sharing workflow is not currently exposed through the shipped UI.

## Current implementation

- `core/scrubber.js` provides bounds-checked media metadata handling for supported inputs.
- The ordinary vault UI does not currently provide a complete media/contact import pipeline that exercises all advertised scrubber behavior.
- Current vessel storage exposes operational metadata in a plaintext `.meta` sidecar; this is an architectural review item, not a solved zero-metadata design.

## Planned user workflow

1. Import a supported item.
2. Show detected metadata before sealing.
3. Let the user choose what to remove.
4. Show local-only versus shared metadata.
5. Seal the sanitized payload.
6. For sharing, create a deliberate export with recipient key, expiry, and audit status.

## Safety requirements

- Never claim metadata was removed unless the format-specific parser proves it.
- Unsupported formats must be clearly labeled and blocked from a “sanitized” claim.
- Sharing must warn when output is plaintext or when metadata remains.
- Tests must cover EXIF, VCard, malformed input, large input, and round-trip preservation.

## Release gate

The feature is not production-ready until the UI path, supported-format matrix, negative tests, and documentation are complete.
