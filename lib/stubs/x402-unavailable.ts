/**
 * Stand-in for the optional x402 payment-protocol packages that @coinbase/cdp-sdk lazily imports.
 * This app never uses x402; the alias in next.config.ts only lets the bundler resolve the import.
 */
function unavailable(): never {
  throw new Error("x402 payments are not enabled in this app");
}

export const x402Client = unavailable;
export const registerExactEvmScheme = unavailable;
export const registerUptoEvmScheme = unavailable;
export const registerExactSvmScheme = unavailable;
export const toClientEvmSigner = unavailable;
const stub = {};
export default stub;
