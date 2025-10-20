import { ethers } from "ethers";
import axios from "axios";

const GRAVITY_RPC = process.env.GRAVITY_RPC || "https://evmrpc-testnet.0g.ai";
const GRAVITY_EXPLORER = process.env.GRAVITY_EXPLORER || "https://explorer-api-testnet.0g.ai";
const provider = new ethers.JsonRpcProvider(GRAVITY_RPC);

const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// Example token list
const tokenList = [
  {
    name: "Gravity Wrapped USDT",
    symbol: "gUSDT",
    address: "0x0000000000000000000000000000000000000000",
  },
];

// ----------------------
// ✅ Serverless function
// ----------------------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { address } = req.query;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Native balance
    const nativeBalance = await provider.getBalance(address);
    const formattedNative = ethers.formatEther(nativeBalance);

    // Token balances
    const tokens = [];
    for (const token of tokenList) {
      if (token.address !== "0x0000000000000000000000000000000000000000") {
        const contract = new ethers.Contract(token.address, erc20Abi, provider);
        const balance = await contract.balanceOf(address);
        const decimals = await contract.decimals();
        const symbol = await contract.symbol();
        const name = await contract.name();
        tokens.push({
          name,
          symbol,
          balance: Number(ethers.formatUnits(balance, decimals)).toFixed(4),
        });
      }
    }

    // Transaction history (try Explorer)
    let history = [];
    try {
      const resp = await axios.get(`${GRAVITY_EXPLORER}/address/${address}/transactions?limit=10`);
      history = resp.data?.transactions || [];
    } catch {
      console.warn("Could not fetch transaction history from explorer");
    }

    // Response
    return res.status(200).json({
      network: "Gravity Network Testnet",
      rpc: GRAVITY_RPC,
      address,
      balance: formattedNative,
      tokens,
      txHistory: history,
    });
  } catch (err) {
    console.error("Error fetching wallet data:", err);
    return res.status(500).json({ error: "Error fetching wallet data" });
  }
        }
