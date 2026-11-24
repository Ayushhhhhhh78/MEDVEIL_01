const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');

const ARTIFACTS_DIR = path.join(__dirname, '..', '..', '..', 'artifacts', 'contracts');
const DEPLOYMENTS_FILE = path.join(__dirname, '..', '..', '..', 'deployed-addresses.json');

let provider = null;
let relayerWallet = null;

function getProvider() {
  if (!provider) {
    const deployment = getDeploymentConfig();
    const isSepolia = deployment.chainId === 11155111 || deployment.network === 'sepolia';
    const rpcUrl = isSepolia
      ? process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'
      : process.env.RPC_URL || 'http://127.0.0.1:8555';
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

function getRelayerWallet() {
  const deployment = getDeploymentConfig();
  const isSepolia = deployment.chainId === 11155111 || deployment.network === 'sepolia';
  const privateKey = isSepolia
    ? process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY
    : process.env.DEPLOYER_PRIVATE_KEY ||
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  if (!privateKey) {
    throw new Error('SEPOLIA_DEPLOYER_PRIVATE_KEY is required for Sepolia relayer transactions.');
  }
  return new ethers.Wallet(privateKey, getProvider());
}

/**
 * Loads deployed contract addresses from deployed-addresses.json or .env
 */
function getContractAddresses() {
  let fileAddresses = {};
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf-8'));
      fileAddresses = data.contracts || {};
    } catch (e) {
      // Environment configuration remains available as a fallback.
    }
  }

  // Explicit environment values take precedence over committed local-dev addresses.
  return {
    Groth16Verifier: process.env.VERIFIER_CONTRACT_ADDRESS || fileAddresses.Groth16Verifier,
    HospitalRegistry: process.env.HOSPITAL_REGISTRY_ADDRESS || fileAddresses.HospitalRegistry,
    PolicyRegistry: process.env.POLICY_REGISTRY_ADDRESS || fileAddresses.PolicyRegistry,
    PatientAccess: process.env.PATIENT_ACCESS_ADDRESS || fileAddresses.PatientAccess,
    TestToken: process.env.TEST_TOKEN_ADDRESS || fileAddresses.TestToken,
    ClaimSettlement: process.env.CLAIM_SETTLEMENT_ADDRESS || fileAddresses.ClaimSettlement,
  };
}

function getDeploymentConfig() {
  const configuredChainId = Number(process.env.CHAIN_ID);
  if (Number.isInteger(configuredChainId) && configuredChainId > 0) {
    return {
      chainId: configuredChainId,
      network:
        configuredChainId === 11155111
          ? 'sepolia'
          : configuredChainId === 80002
            ? 'amoy'
            : configuredChainId === 31337
              ? 'localhost'
              : 'custom',
      policyRegistryAddress: process.env.POLICY_REGISTRY_ADDRESS,
    };
  }

  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    const data = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf-8'));
    return {
      chainId: Number(data.chainId),
      network: data.network,
      policyRegistryAddress: data.contracts?.PolicyRegistry,
    };
  }

  return {
    chainId: 31337,
    network: 'localhost',
    policyRegistryAddress: process.env.POLICY_REGISTRY_ADDRESS,
  };
}

/**
 * Loads ABI from compiled Hardhat artifact
 */
function getContractAbi(contractPath, contractName) {
  const artifactPath = path.join(ARTIFACTS_DIR, contractPath, `${contractName}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found at ${artifactPath}. Run npx hardhat compile.`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return artifact.abi;
}

/**
 * Returns an ethers Contract instance connected to the relayer wallet
 */
function getContract(name) {
  const addresses = getContractAddresses();
  const address = addresses[name];
  if (!address) {
    throw new Error(`Address for ${name} not configured. Run deployment script first.`);
  }

  let contractFile, contractName;
  switch (name) {
    case 'ClaimSettlement':
      contractFile = 'ClaimSettlement.sol';
      contractName = 'ClaimSettlement';
      break;
    case 'HospitalRegistry':
      contractFile = 'HospitalRegistry.sol';
      contractName = 'HospitalRegistry';
      break;
    case 'PolicyRegistry':
      contractFile = 'PolicyRegistry.sol';
      contractName = 'PolicyRegistry';
      break;
    case 'PatientAccess':
      contractFile = 'PatientAccess.sol';
      contractName = 'PatientAccess';
      break;
    case 'TestToken':
      contractFile = 'TestToken.sol';
      contractName = 'TestToken';
      break;
    case 'Groth16Verifier':
      contractFile = 'Verifier.sol';
      contractName = 'Groth16Verifier';
      break;
    default:
      throw new Error(`Unknown contract ${name}`);
  }

  const abi = getContractAbi(contractFile, contractName);
  return new ethers.Contract(address, abi, getRelayerWallet());
}

/**
 * Checks on-chain nullifier status
 */
async function checkNullifierUsed(nullifier) {
  try {
    const settlementContract = getContract('ClaimSettlement');
    const isUsed = await settlementContract.isNullifierUsed(nullifier);
    return isUsed;
  } catch (err) {
    return false;
  }
}

/**
 * Checks if policy commitment is active on-chain
 */
async function checkPolicyActive(commitment) {
  try {
    const policyContract = getContract('PolicyRegistry');
    const isActive = await policyContract.isPolicyActive(commitment);
    return isActive;
  } catch (err) {
    return false;
  }
}

/**
 * Submits Groth16 proof to ClaimSettlement contract on-chain
 */
async function submitClaimProofOnChain(calldata) {
  const settlementContract = getContract('ClaimSettlement');

  // Submit verifyAndSettleClaim transaction
  const tx = await settlementContract.verifyAndSettleClaim(
    calldata.a,
    calldata.b,
    calldata.c,
    calldata.input
  );

  // Wait for 1 confirmation
  const receipt = await tx.wait(1);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status === 1 ? 'SUCCESS' : 'FAILED',
  };
}

/**
 * Registers medical record on-chain via PatientAccess contract
 */
async function registerRecordOnChain(recordId, ipfsCid, fileHash, recordType, patientSigner = null) {
  try {
    const signer = patientSigner || getRelayerWallet();
    const addresses = getContractAddresses();
    const abi = getContractAbi('PatientAccess.sol', 'PatientAccess');
    const contract = new ethers.Contract(addresses.PatientAccess, abi, signer);

    const tx = await contract.registerRecord(recordId, ipfsCid, fileHash, recordType);
    const receipt = await tx.wait(1);
    return receipt.hash;
  } catch (err) {
    console.warn('PatientAccess on-chain registration fallback:', err.message);
    return null;
  }
}

/**
 * Grants doctor access on-chain via PatientAccess contract
 */
async function grantDoctorAccessOnChain(recordId, doctorAddress, expiresAt, patientSigner = null) {
  try {
    const signer = patientSigner || getRelayerWallet();
    const addresses = getContractAddresses();
    const abi = getContractAbi('PatientAccess.sol', 'PatientAccess');
    const contract = new ethers.Contract(addresses.PatientAccess, abi, signer);

    // Auto-register record reference on PatientAccess contract if not yet registered
    try {
      const recordOnChain = await contract.records(recordId);
      if (!recordOnChain || recordOnChain.recordId === 0n || recordOnChain.patientAddress === ethers.ZeroAddress) {
        const regTx = await contract.registerRecord(
          recordId,
          `ipfs://medveil-record-${recordId}`,
          ethers.id(`medveil-record-hash-${recordId}`),
          'SURGICAL_SUMMARY'
        );
        await regTx.wait(1);
      }
    } catch (regErr) {
      // Continue if already registered
    }

    const tx = await contract.grantAccess(recordId, doctorAddress, expiresAt);
    const receipt = await tx.wait(1);
    return receipt.hash;
  } catch (err) {
    console.warn('PatientAccess on-chain grant fallback:', err.message);
    return null;
  }
}

/**
 * Revokes doctor access on-chain via PatientAccess contract
 */
async function revokeDoctorAccessOnChain(recordId, doctorAddress, patientSigner = null) {
  try {
    const signer = patientSigner || getRelayerWallet();
    const addresses = getContractAddresses();
    const abi = getContractAbi('PatientAccess.sol', 'PatientAccess');
    const contract = new ethers.Contract(addresses.PatientAccess, abi, signer);

    try {
      const recordOnChain = await contract.records(recordId);
      if (!recordOnChain || recordOnChain.recordId === 0n || recordOnChain.patientAddress === ethers.ZeroAddress) {
        const regTx = await contract.registerRecord(
          recordId,
          `ipfs://medveil-record-${recordId}`,
          ethers.id(`medveil-record-hash-${recordId}`),
          'SURGICAL_SUMMARY'
        );
        await regTx.wait(1);
      }
    } catch (regErr) {
      // Continue if already registered
    }

    const tx = await contract.revokeAccess(recordId, doctorAddress);
    const receipt = await tx.wait(1);
    return receipt.hash;
  } catch (err) {
    console.warn('PatientAccess on-chain revoke fallback:', err.message);
    return null;
  }
}

/**
 * Authorizes an insurer address on-chain via PolicyRegistry contract
 */
async function authorizeInsurerOnChain(insurerAddress) {
  const contract = getContract('PolicyRegistry');
  const isAlready = await contract.authorizedInsurers(insurerAddress);
  if (isAlready) {
    return {
      txHash: 'ALREADY_AUTHORIZED',
      authorizedAddress: insurerAddress,
    };
  }
  const tx = await contract.setInsurerAuthorization(insurerAddress, true);
  const receipt = await tx.wait(1);
  return {
    txHash: receipt.hash,
    authorizedAddress: insurerAddress,
  };
}

module.exports = {
  getProvider,
  getRelayerWallet,
  getContractAddresses,
  getContract,
  getDeploymentConfig,
  checkNullifierUsed,
  checkPolicyActive,
  submitClaimProofOnChain,
  registerRecordOnChain,
  grantDoctorAccessOnChain,
  revokeDoctorAccessOnChain,
  authorizeInsurerOnChain,
};
