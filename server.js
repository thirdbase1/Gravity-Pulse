/**
 * GravityPulse backend (fixed for Railway + Vercel integration)
 * - Express API
 * - Supabase cache
 * - Ethers.js RPC fallback for chain reads
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import axios from "axios";

dotenv.config();

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CHAINS_RPC_URL = process.env.CHAINS_RPC_URL || "";
const CHAINS_CAN_API_URL = process.env.CHAINS_CAN_API_URL || "https://chainscan-galileo.0g.ai";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://gravity-pulse.vercel.app"; // your vercel frontend

// --- Environment check ---
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials - set SUPABASE_URL and SUPABASE_KEY");
  process.exit(1);
}

// --- Initialize Supabase client ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// --- Initialize Express ---
const app = express();
app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// --- Basic rate limit ---
app.use(
  rateLimit({
    windowMs: 15 * 1000,
    max: 10,
  })
);

// --- Ethers provider ---
let provider = null;
if (CHAINS_RPC_URL) {
  provider = new ethers.JsonRpcProvider(CHAINS_RPC_URL);
  console.log("✅ Using RPC provider:", CHAINS_RPC_URL);
} else {
  console.log("⚠️ No RPC provider configured. Using Chainscan API fallback.");
}

// --- Utils ---
function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function computeAchievements(walletData) {
  const achievements = [];
  if ((walletData.totalTransactions || 0) >= 1)
    achievements.push({ id: "first_steps", earned: true });
  if ((walletData.holdDays || 0) >= 30)
    achievements.push({ id: "diamond_hands", earned: true });
  if ((walletData.totalTransactions || 0) >= 100)
    achievements.push({ id: "active_trader", earned: true });
  if ((walletData.nativeBalance || 0) >= 10000)
    achievements.push({ id: "whale_status", earned: true });

  const all = [
    { id: "first_steps", title: "First Steps", desc: "Made first transaction" },
    { id: "diamond_hands", title: "Diamond Hands", desc: "Held tokens 30+ days" },
    { id: "active_trader", title: "Active Trader", desc: "100+ transactions" },
    { id: "whale_status", title: "Whale Status", desc: "Hold 10,000+ FOGO" },
    { id: "sniper", title: "Sniper", desc: "Early token adopter" },
    { id: "gravity_king", title: "Gravity King", desc: "Top 100 holder" },
  ];

  return all.map((a) => ({
    ...a,
    earned: !!achievements.find((x) => x.id === a.id),
  }));
}

// --- Supabase helpers ---
async function getCachedWallet(address) {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("address", address.toLowerCase())
    .limit(1)
    .single();
  return error ? null : data;
}

async function upsertCachedWallet(address, payload) {
  await supabase.from("wallets").upsert(
    {
      address: address.toLowerCase(),
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "address" }
  );
}

// --- Chain fetch logic ---
async function fetchOnChainData(address) {
  const result = {
    address,
    nativeBalance: 0,
    tokens: [],
    transactions: [],
    totalTransactions: 0,
    usdValue: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    if (provider) {
      const balBN = await provider.getBalance(address);
      result.nativeBalance = Number(ethers.formatEther(balBN));
    }
  } catch (err) {
    console.warn("⚠️ RPC balance fetch failed:", err.message);
  }

  try {
    const txListUrl = `${CHAINS_CAN_API_URL}/api?module=account&action=txlist&address=${address}`;
    const txResp = await axios.get(txListUrl, { timeout: 7000 });
    if (Array.isArray(txResp.data.result)) {
      result.transactions = txResp.data.result.slice(-100).reverse();
      result.totalTransactions = txResp.data.result.length;
    }
  } catch (err) {
    console.warn("⚠️ Chainscan tx fetch failed:", err.message);
  }

  result.usdValue = result.nativeBalance * 0.0;
  return result;
}

// --- API endpoints ---
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    backend: "GravityPulse",
  });
});

app.get("/api/wallet/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });

    const cache = await getCachedWallet(address);
    if (cache) {
      const updatedAt = new Date(cache.updated_at);
      const ageSec = (Date.now() - updatedAt.getTime()) / 1000;
      if (ageSec < 60) {
        const payload = cache.payload;
        payload.cached = true;
        payload.achievements = computeAchievements(payload);
        return res.json(payload);
      }
    }

    const chainData = await fetchOnChainData(address);
    chainData.achievements = computeAchievements(chainData);
    await upsertCachedWallet(address, chainData);
    res.json({ ...chainData, cached: false });
  } catch (err) {
    console.error("❌ Wallet fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Start server ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 GravityPulse backend running at http://localhost:${PORT}`);
});
