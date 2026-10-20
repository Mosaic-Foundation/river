// Browser script for the identity host's passkey pages, bundled by `npm run build:identity-client`
// into identity/public/passkey.js (spec Appendix A). M7 fills it with the @simplewebauthn/browser
// ceremonies; until then it only marks that it loaded, so the bundle step and its serving are
// exercised from M0.
document.documentElement.dataset.passkey = "ready";

export {};
