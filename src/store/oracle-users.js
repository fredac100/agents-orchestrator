import oracledb from 'oracledb';
import { v4 as uuidv4 } from 'uuid';

const TABLE = 'ORCHESTRATOR_USERS';

const COL_MAP = {
  name: 'NAME', email: 'EMAIL', passwordHash: 'PASSWORD_HASH',
  role: 'ROLE', plan: 'PLAN', active: 'ACTIVE',
  monthlyExecutions: 'MONTHLY_EXECUTIONS', monthlyExecReset: 'MONTHLY_EXEC_RESET',
  stripeCustomerId: 'STRIPE_CUSTOMER_ID', stripeSubscriptionId: 'STRIPE_SUBSCRIPTION_ID',
  stripeSubscriptionStatus: 'STRIPE_SUBSCRIPTION_STATUS',
  planUpdatedAt: 'PLAN_UPDATED_AT', lastLoginAt: 'LAST_LOGIN_AT',
};

function toDate(v) {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function rowToUser(row) {
  return {
    id: row.ID,
    name: row.NAME,
    email: row.EMAIL,
    passwordHash: row.PASSWORD_HASH,
    role: row.ROLE || 'owner',
    plan: row.PLAN || 'free',
    active: row.ACTIVE === 1,
    monthlyExecutions: row.MONTHLY_EXECUTIONS || 0,
    monthlyExecReset: row.MONTHLY_EXEC_RESET?.toISOString() || new Date().toISOString(),
    stripeCustomerId: row.STRIPE_CUSTOMER_ID || null,
    stripeSubscriptionId: row.STRIPE_SUBSCRIPTION_ID || null,
    stripeSubscriptionStatus: row.STRIPE_SUBSCRIPTION_STATUS || null,
    planUpdatedAt: row.PLAN_UPDATED_AT?.toISOString() || null,
    lastLoginAt: row.LAST_LOGIN_AT?.toISOString() || null,
    created_at: row.CREATED_AT?.toISOString() || new Date().toISOString(),
    updated_at: row.UPDATED_AT?.toISOString() || new Date().toISOString(),
  };
}

function bindVal(field, value) {
  if (field === 'active') return value ? 1 : 0;
  const col = COL_MAP[field] || '';
  if (col.endsWith('_AT') || col.endsWith('_RESET')) return toDate(value);
  return value ?? null;
}

export async function createOracleUsersStore(config) {
  oracledb.autoCommit = true;

  const pool = await oracledb.createPool({
    user: config.user || 'local123',
    password: config.password || 'local123',
    connectString: config.connectString || 'oracle18c:1521/XEPDB1',
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
  });

  let mem = [];

  const conn = await pool.getConnection();
  try {
    const result = await conn.execute(
      `SELECT * FROM ${TABLE}`, [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    mem = result.rows.map(rowToUser);
    console.log(`[oracle-users] ${mem.length} usuário(s) carregado(s)`);
  } finally {
    await conn.close();
  }

  function clone(v) { return structuredClone(v); }

  async function exec(sql, binds = {}) {
    const c = await pool.getConnection();
    try {
      await c.execute(sql, binds);
    } finally {
      await c.close();
    }
  }

  return {
    getAll() { return clone(mem); },

    getById(id) {
      const item = mem.find(i => i.id === id);
      return item ? clone(item) : null;
    },

    findById(id) { return this.getById(id); },

    count() { return mem.length; },

    filter(predicate) { return mem.filter(predicate).map(clone); },

    create(data) {
      const item = {
        id: data.id || uuidv4(),
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mem.push(item);

      exec(
        `INSERT INTO ${TABLE} (ID, NAME, EMAIL, PASSWORD_HASH, ROLE, PLAN, ACTIVE,
          MONTHLY_EXECUTIONS, MONTHLY_EXEC_RESET,
          STRIPE_CUSTOMER_ID, STRIPE_SUBSCRIPTION_ID, STRIPE_SUBSCRIPTION_STATUS,
          CREATED_AT, UPDATED_AT)
         VALUES (:id, :name, :email, :pwHash, :role, :plan, :active,
          :execCount, :execReset,
          :stripeCust, :stripeSub, :stripeStatus,
          :createdAt, :updatedAt)`,
        {
          id: item.id,
          name: item.name || '',
          email: item.email || '',
          pwHash: item.passwordHash || '',
          role: item.role || 'owner',
          plan: item.plan || 'free',
          active: item.active !== false ? 1 : 0,
          execCount: item.monthlyExecutions || 0,
          execReset: toDate(item.monthlyExecReset) || new Date(),
          stripeCust: item.stripeCustomerId || null,
          stripeSub: item.stripeSubscriptionId || null,
          stripeStatus: item.stripeSubscriptionStatus || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ).catch(e => console.error('[oracle-users] INSERT erro:', e.message));

      return clone(item);
    },

    update(id, data) {
      const i = mem.findIndex(x => x.id === id);
      if (i === -1) return null;
      mem[i] = { ...mem[i], ...data, id, updated_at: new Date().toISOString() };

      const setClauses = ['UPDATED_AT = :updatedAt'];
      const binds = { id, updatedAt: new Date() };

      for (const [field, col] of Object.entries(COL_MAP)) {
        if (!(field in data)) continue;
        setClauses.push(`${col} = :${field}`);
        binds[field] = bindVal(field, data[field]);
      }

      exec(
        `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE ID = :id`,
        binds,
      ).catch(e => console.error('[oracle-users] UPDATE erro:', e.message));

      return clone(mem[i]);
    },

    delete(id) {
      const i = mem.findIndex(x => x.id === id);
      if (i === -1) return false;
      mem.splice(i, 1);
      exec(`DELETE FROM ${TABLE} WHERE ID = :id`, { id })
        .catch(e => console.error('[oracle-users] DELETE erro:', e.message));
      return true;
    },

    save(items) {
      if (Array.isArray(items)) mem = items;
    },

    flush() {},

    setMaxSize() {},
  };
}
