# MEDVEIL — Render deployment

This repository includes a Render Blueprint at the repository root. It defines a Node API service and a Next.js web service.

## Before deploying

1. Deploy the Sepolia contracts from a trusted, controlled environment using a dedicated testnet wallet.
2. Set the resulting six contract addresses in the API service environment.
3. Prepare the circuit WASM, proving key, verification key, and Solidity verifier from the exact same circuit and trusted setup. The current repository setup script uses fixed entropy strings and is **not** a production trusted ceremony. Do not describe this as production-grade cryptographic setup.
4. Confirm the required circuit artifacts are present in the API runtime at:
   - `circuits/build/ClaimVerification_js/ClaimVerification.wasm`
   - `circuits/build/claim_final.zkey`
   - `circuits/build/verification_key.json`
   and that `contracts/Verifier.sol` was generated from that same proving key before compiling/deploying contracts.
5. Never commit RPC credentials, private keys, JWT secrets, AES keys, or real patient data.

## Render Blueprint

Use Render Dashboard → New → Blueprint and select this repository and branch `deploy/render-hosting`. Review the proposed services before applying.

The API service uses a persistent disk mounted at `/var/data`; SQLite and encrypted uploaded files are configured to live there. The disk requires a paid Render service plan. The frontend is configured to consume the API service host from the Blueprint.

## API environment variables

Set these in the Render API service:

- `SEPOLIA_RPC_URL`: RPC endpoint for Sepolia.
- `SEPOLIA_DEPLOYER_PRIVATE_KEY`: dedicated testnet wallet key only; never a wallet containing real funds.
- `VERIFIER_CONTRACT_ADDRESS`, `HOSPITAL_REGISTRY_ADDRESS`, `POLICY_REGISTRY_ADDRESS`, `PATIENT_ACCESS_ADDRESS`, `TEST_TOKEN_ADDRESS`, `CLAIM_SETTLEMENT_ADDRESS`: addresses from the Sepolia deployment.
- `JWT_SECRET` and `AES_MASTER_KEY`: unique production secrets. Preserve the AES key permanently; changing it can make previously wrapped document keys undecryptable.

The service is configured with `CHAIN_ID=11155111`. Environment contract addresses override the committed local-development deployment JSON.

## Important limitations

- The repository currently stores uploaded encrypted files on local disk. The Blueprint persists these files but does not turn the mock CID adapter into real IPFS.
- The ZK proving artifacts are not built by this Blueprint. Until the exact matching artifacts are prepared and included in the runtime, proof generation and local verification cannot be considered deploy-ready.
- The database and encrypted-file disk is attached only to the API service. Do not scale that service to multiple instances with this storage design.
- Seed data is not automatically run at startup; do not run the destructive seed script against a live database.
- This is a hackathon/testnet deployment configuration, not a production healthcare deployment.

## Local development

The local defaults remain unchanged. Run the backend from the repository root with `npm run backend:dev`, and the frontend with `cd frontend && npm run dev`.
