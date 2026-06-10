import { ethers } from "hardhat";

/**
 * Deploy PriceSnapshot to Ethereum Sepolia.
 *
 * The CRE forwarder address for Sepolia is passed via the
 * FORWARDER_ADDRESS environment variable (see .env.example).
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */
async function main() {
  const forwarderAddress = process.env.FORWARDER_ADDRESS;
  if (!forwarderAddress) {
    throw new Error(
      "FORWARDER_ADDRESS not set. " +
      "Check your .env file and set it to the CRE forwarder for Sepolia."
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  console.log("Forwarder address:", forwarderAddress);

  const PriceSnapshot = await ethers.getContractFactory("PriceSnapshot");
  const contract = await PriceSnapshot.deploy(forwarderAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ PriceSnapshot deployed to:", address);
  console.log("\nAdd this to your .env / secrets.yaml:");
  console.log(`  CONTRACT_ADDRESS=${address}`);
  console.log(
    "\nVerify on Etherscan (optional):\n" +
    `  npx hardhat verify --network sepolia ${address} "${forwarderAddress}"`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
