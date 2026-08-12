// 购物车模块 — 修复版

const DISCOUNTS = {
  VIP50: 0.5,
  VIP20: 0.8,
};

function calcTotal(items) {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const price = items[i]?.price;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    total = Math.round((total + price) * 100) / 100;
  }
  return total;
}

function addItem(cart, item) {
  if (!Array.isArray(cart)) throw new Error("cart must be an array");
  if (!item || typeof item !== "object") throw new Error("item must be an object");
  cart.push(item);
}

function removeItem(cart, name) {
  if (!Array.isArray(cart)) throw new Error("cart must be an array");
  for (let i = cart.length - 1; i >= 0; i--) {
    if (cart[i].name === name) {
      cart.splice(i, 1);
    }
  }
}

function applyDiscount(price, code) {
  const rate = DISCOUNTS[code];
  if (rate !== undefined) {
    return price * rate;
  }
  return price;
}

async function getUserCart(userId, db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("db with query method is required");
  }
  try {
    const rows = await db.query("SELECT * FROM carts WHERE user_id = ?", [userId]);
    return rows;
  } catch (err) {
    throw new Error(`Failed to fetch cart for user ${userId}: ${err.message}`);
  }
}

module.exports = { calcTotal, addItem, removeItem, applyDiscount, getUserCart };
