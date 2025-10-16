// server.js — GravityPulse Backend (Gravity Network)
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// 🔒 Middleware
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// ─────────────────────────────────────────────
// 🌐 Gravity Network RPC Configuration
// ─────────────────────────────────────────────
const GRAVITY_RPC = process.env.GRAVITY_RPC || "https://evmrpc-testnet.0g.ai";
const provider = new ethers.JsonRpcProvider(GRAVITY_RPC);

// Optional: Gravity Explorer API (replace if needed)
const GRAVITY_EXPLORER = process.env.GRAVITY_EXPLORER || "https://explorer-api-testnet.0g.ai";

// ─────────────────────────────────────────────
// 🧠 Utility: Fetch ERC20 Token Balance
// ─────────────────────────────────────────────
const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// Example token list — you can extend this with more Gravity tokens
const tokenList = [
  {
    name: "Gravity Wrapped USDT",
    symbol: "gUSDT",
    address: "0x0000000000000000000000000000000000000000", // Replace with real token address
  },
];

// ─────────────────────────────────────────────
// 🌍 Root Endpoint
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("🚀 GravityPulse backend is running on Gravity Network!");
});

// ─────────────────────────────────────────────
// 💰 Wallet Data Endpoint
// ─────────────────────────────────────────────
app.get("/api/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // ✅ Native Balance
    const nativeBalance = await provider.getBalance(address);
    const formattedNative = ethers.formatEther(nativeBalance);

    // ✅ ERC20 Balances
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

    // ✅ Transaction History (try fetching from explorer)
    let history = [];
    try {
      const resp = await axios.get(`${GRAVITY_EXPLORER}/address/${address}/transactions?limit=10`);
      history = resp.data?.transactions || [];
    } catch (err) {
      console.warn("⚠️ Could not fetch transaction history from explorer.");
    }

    // ✅ Response
    res.json({
      network: "Gravity Network Testnet",
      rpc: GRAVITY_RPC,
      address,
      nativeBalance: formattedNative,
      tokens,
      txHistory: history,
    });
  } catch (error) {
    console.error("❌ Error fetching wallet data:", error);
    res.status(500).json({ error: "Error fetching wallet data" });
  }
});

// ─────────────────────────────────────────────
// 🚀 Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 GravityPulse backend running on port ${PORT}`);
});
