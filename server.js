// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());

// ✅ Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// ✅ Gravity Network RPC
const GRAVITY_RPC = process.env.GRAVITY_RPC || "https://evmrpc-testnet.0g.ai";
const provider = new ethers.JsonRpcProvider(GRAVITY_RPC);

// ✅ Test endpoint
app.get("/", (req, res) => {
  res.send("🚀 GravityPulse backend is running on Gravity Network!");
});

// ✅ Wallet data endpoint
app.get("/api/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const balance = await provider.getBalance(address);
    const formatted = ethers.formatEther(balance);

    res.json({
      network: "Gravity Network Testnet",
      address,
      balance: formatted,
      rpc: GRAVITY_RPC,
    });
  } catch (error) {
    console.error("❌ Error fetching wallet data:", error);
    res.status(500).json({ error: "Error fetching wallet data" });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
