/**
 * GravityPulse backend
 * - Express API
 * - Supabase cache
 * - Ethers.js RPC fallback for chain reads
 *
 * Environment variables (see .env.example):
 * - SUPABASE_URL
 * - SUPABASE_KEY
 * - CHAINS_RPC_URL        (optional; JSON-RPC provider for FogoChain testnet)
 * - CHAINS_CAN_API_URL    (optional; Chainscan-like API base URL)
 * - PORT
 * - CORS_ORIGIN           (frontend origin, e.g. https://your-vercel-app.vercel.app)
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
const CHAINS_RPC_URL = process.env.CHAINS_RPC_URL || ""; // e.g. https://rpc-galileo.fogochain.test
const CHAINS_CAN_API_URL = process.env.CHAINS_CAN_API_URL || "https://chainscan-galileo.0g.ai"; // provided as example
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase credentials - set SUPABASE_URL and SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));

// Basic rate limiting (adjust for testnet)
const limiter = rateLimit({
  windowMs: 15 * 1000, // 15s
  max: 10, // max 10 requests per IP per 15s
});
app.use(limiter);

// Ethers provider (if empty, many endpoints still work via Chainscan-style API)
let provider = null;
if (CHAINS_RPC_URL) {
  provider = new ethers.JsonRpcProvider(CHAINS_RPC_URL);
  console.log("Using RPC provider:", CHAINS_RPC_URL);
} else {
  console.log("No RPC provider configured. Falling back to Chainscan API where possible.");
}

// Utility: validate 0x address
function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// Achievement rules (simple)
function computeAchievements(walletData) {
  const achievements = [];
  // sample rules
  if ((walletData.totalTransactions || 0) >= 1) {
    achievements.push({ id: "first_steps", title: "First Steps", desc: "Made first transaction", earned: true });
  }
  if ((walletData.holdDays || 0) >= 30) {
    achievements.push({ id: "diamond_hands", title: "Diamond Hands", desc: "Held tokens 30+ days", earned: true });
  }
  if ((walletData.totalTransactions || 0) >= 100) {
    achievements.push({ id: "active_trader", title: "Active Trader", desc: "100+ transactions", earned: true });
  }
  if ((walletData.nativeBalance || 0) >= 10000) {
    achievements.push({ id: "whale_status", title: "Whale Status", desc: "Hold 10,000+ FOGO", earned: true });
  }
  // Always include "locked/unlocked" placeholders for the UI
  const all = [
    { id: "first_steps", title: "First Steps", desc: "Made first transaction" },
    { id: "diamond_hands", title: "Diamond Hands", desc: "Held tokens 30+ days" },
    { id: "active_trader", title: "Active Trader", desc: "100+ transactions" },
    { id: "whale_status", title: "Whale Status", desc: "Hold 10,000+ FOGO" },
    { id: "sniper", title: "Sniper", desc: "Early token adopter" },
    { id: "gravity_king", title: "Gravity King", desc: "Top 100 holder" }
  ];

  // merge earned flag
  return all.map(a => {
    const e = achievements.find(x => x.id === a.id);
    return { ...a, earned: !!e };
  });
}

// Cache helpers using Supabase
async function getCachedWallet(address) {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("address", address.toLowerCase())
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 occurs when table not present or no rows; ignore in that case
    // We return null if not present
  }
  return data || null;
}

async function upsertCachedWallet(address, payload) {
  const record = {
    address: address.toLowerCase(),
    payload,
    updated_at: new Date().toISOString(),
  };
  await supabase.from("wallets").upsert(record, { onConflict: "address" });
}

// Fetch balance & txs from RPC or Chainscan-style API
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

  // 1) Try RPC for balance
  try {
    if (provider) {
      const balBN = await provider.getBalance(address);
      const bal = Number(ethers.formatEther(balBN));
      result.nativeBalance = bal;
    }
  } catch (err) {
    console.warn("RPC balance fetch failed:", err.message || err);
  }

  // 2) Try a Chainscan-style API for tx history and token balances (best-effort)
  try {
    // many Etherscan clones accept: /api?module=account&action=txlist&address=...
    const txListUrl = `${CHAINS_CAN_API_URL}/api?module=account&action=txlist&address=${address}`;
    const txResp = await axios.get(txListUrl, { timeout: 7000 }).catch(() => null);
    if (txResp && txResp.data) {
      // some APIs return {status: "1", result: [...]}
      if (Array.isArray(txResp.data.result)) {
        result.transactions = txResp.data.result.slice(-100).reverse(); // limit to 100 recent
        result.totalTransactions = txResp.data.result.length;
      }
    }
  } catch (err) {
    console.warn("Chainscan txlist fetch failed:", err.message || err);
  }

  // 3) Token balances
  try {
    const tokenUrl = `${CHAINS_CAN_API_URL}/api?module=account&action=tokenbalance&address=${address}`;
    // NOTE: tokenbalance often requires contract parameter; this is best-effort
    const tresp = await axios.get(tokenUrl, { timeout: 7000 }).catch(() => null);
    // fallback: if no tokens, keep tokens empty
    if (tresp && tresp.data && tresp.data.result) {
      // best-effort parsing
      // If this endpoint not available, we leave tokens empty and UI shows native only
    }
  } catch (err) {
    console.warn("Chainscan token fetch failed:", err.message || err);
  }

  // 4) Compute derived metadata (very simple)
  result.usdValue = result.nativeBalance * 0.0; // by default testnet value unknown; UI can replace with price lookup
  result.lastUpdated = new Date().toISOString();

  return result;
}

// API Endpoints

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", now: new Date().toISOString(), chainId: 16602, chainName: "FogoChain (Gravity Testnet)" });
});

// Wallet overview (balance, totals, achievements)
app.get("/api/wallet/:address/overview", async (req, res) => {
  try {
    const address = req.params.address;
    if (!isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });

    // Check cache
    const cache = await getCachedWallet(address);
    if (cache) {
      // TTL: 60 seconds for testnet (adjust as needed)
      const updatedAt = new Date(cache.updated_at);
      const ageSec = (Date.now() - updatedAt.getTime()) / 1000;
      if (ageSec < 60) {
        // return cached payload
        const payload = cache.payload;
        payload.cached = true;
        payload.achievements = computeAchievements(payload);
        return res.json(payload);
      }
    }

    // fetch on-chain
    const chainData = await fetchOnChainData(address);

    // add computed achievements
    chainData.achievements = computeAchievements(chainData);

    // upsert cache
    await upsertCachedWallet(address, chainData);

    res.json({ ...chainData, cached: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Transactions (paginated)
app.get("/api/wallet/:address/txs", async (req, res) => {
  try {
    const address = req.params.address;
    if (!isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });

    // Simple: fetch cached then return transactions
    const cache = await getCachedWallet(address);
    if (cache && cache.payload && cache.payload.transactions) {
      return res.json({ txs: cache.payload.transactions });
    }

    // fallback: fetch fresh
    const chainData = await fetchOnChainData(address);
    await upsertCachedWallet(address, chainData);
    res.json({ txs: chainData.transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Token holdings
app.get("/api/wallet/:address/tokens", async (req, res) => {
  try {
    const address = req.params.address;
    if (!isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });

    const cache = await getCachedWallet(address);
    if (cache && cache.payload && cache.payload.tokens) {
      return res.json({ tokens: cache.payload.tokens });
    }

    const chainData = await fetchOnChainData(address);
    await upsertCachedWallet(address, chainData);
    res.json({ tokens: chainData.tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Leaderboard (simple top holders by cached nativeBalance)
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("wallets")
      .select("address, payload")
      .order("payload->>nativeBalance", { ascending: false }) // Postgres JSON ordering
      .limit(50);

    if (error) {
      console.warn("Leaderboard supabase error:", error);
      return res.json({ leaderboard: [] });
    }

    const leaderboard = (data || []).map((r) => {
      const p = r.payload || {};
      return {
        address: r.address,
        nativeBalance: p.nativeBalance || 0,
        totalTransactions: p.totalTransactions || 0,
      };
    });

    res.json({ leaderboard });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Basic admin endpoint to clear cache for an address (for maintenance)
// This should be protected in production (token or admin auth)
app.post("/api/admin/clear-cache", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });

    const { error } = await supabase.from("wallets").delete().eq("address", address.toLowerCase());
    if (error) return res.status(500).json({ error: "Failed to clear cache" });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`GravityPulse backend listening on port ${PORT}`);
});
