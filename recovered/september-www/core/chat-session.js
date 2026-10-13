import { RatchetState } from './double-ratchet.js';

/**
 * PeerChatSession binds the proven Double Ratchet to a relationship root
 * secret derived from mutually verified static ECDH keys (chat-identity.js).
 *
 * Roles match the ratchet: the party that sends the first message is the
 * "initiator" (Alice side); the party that receives first is the "receiver"
 * (Bob side). Neither side ever sends a vault secret or a private key.
 */
export class PeerChatSession {
    constructor({ role, rootSecret, staticPair, peerPublicKey }) {
        if (role !== 'initiator' && role !== 'receiver') throw new Error('session role must be initiator or receiver');
        if (!rootSecret || !staticPair) throw new Error('rootSecret and staticPair are required');
        this.role = role;
        this._state = new RatchetState();
        this._ready = role === 'initiator'
            ? this._state.initAsAlice(rootSecret, peerPublicKey)
            : this._state.initAsBob(rootSecret, staticPair);
    }

    async encrypt(plaintext) {
        await this._ready;
        return this._state.ratchetEncrypt(plaintext);
    }

    async decrypt(header, ciphertext, iv) {
        await this._ready;
        const plain = await this._state.ratchetDecrypt(header, ciphertext, iv);
        return new TextDecoder().decode(plain);
    }

    /** Snapshot the whole session for sealed-at-rest persistence. */
    async serialize() {
        await this._ready;
        const state = await this._state.serialize();
        return state ? { role: this.role, state } : null;
    }

    /** Rebuild a PeerChatSession (ready to encrypt/decrypt) from a snapshot. */
    static async restore(snapshot) {
        if (!snapshot || (snapshot.role !== 'initiator' && snapshot.role !== 'receiver')) {
            throw new Error('session restore: invalid snapshot');
        }
        const session = Object.create(PeerChatSession.prototype);
        session.role = snapshot.role;
        session._state = await RatchetState.restore(snapshot.state);
        session._ready = Promise.resolve();
        return session;
    }
}