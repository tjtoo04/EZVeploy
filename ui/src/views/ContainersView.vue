<template>
  <section aria-label="Containers">
    <header class="page-head">
      <h1 class="page-title">Containers</h1>
      <span class="page-meta">{{ `${daemonUp}/${daemonTotal} daemons · ${containerCount} running` }}</span>
      <div class="page-actions">
        <p-button v-if="error" label="Retry" class="p-button-outlined" @click="load" />
        <p-button icon="pi pi-refresh" label="Refresh" @click="load" />
      </div>
    </header>

    <p-message v-if="error" severity="error" :closable="false" class="error-band">{{ error }}</p-message>

    <div class="wall" v-if="!error">
      <p-datatable
        :value="rows"
        row-group-mode="subheader"
        group-rows-by="user"
        sort-field="user"
        :sort-order="0"
        :show-gridlines="false"
        @row-click="open"
      >
        <template #groupheader="{ data }">
          <div class="shelf">
            <span class="shelf-pull" aria-hidden="true"></span>
            <span class="shelf-name">{{ shelfLabel(data.user) }}</span>
            <span class="shelf-uid">{{ shelfUid(data.user) }}</span>
            <span class="daemon-chip" v-if="daemonState(data.user)" :class="daemonState(data.user)">
              <span class="dot" aria-hidden="true"></span>{{ daemonState(data.user) }}
            </span>
            <span class="shelf-hint">{{ shelfHint(data.user) }}</span>
          </div>
        </template>

        <p-column field="name" header="Container">
          <template #body="{ data }">
            <span v-if="data.name" class="cell-name">
              {{ data.name }} <span class="c-id">{{ shortId(data.id) }}</span>
            </span>
            <span v-else-if="data.daemonDown" class="cell-empty">daemon down — containers invisible</span>
            <span v-else class="cell-empty">— no containers on this daemon</span>
          </template>
        </p-column>
        <p-column field="image" header="Image">
          <template #body="{ data }">
            <span v-if="data.image" class="cell-image">{{ data.image }}</span>
          </template>
        </p-column>
        <p-column field="ports" header="Ports">
          <template #body="{ data }">
            <template v-if="data.ports && data.ports.length">
              <span v-for="(p, i) in data.ports" :key="i" class="cell-ports">
                <span class="port">{{ p.public ? p.public + '→' : '' }}{{ p.internal }}<span class="arrow">›</span>{{ p.proto ?? 'tcp' }}</span>
              </span>
            </template>
          </template>
        </p-column>
        <p-column field="status" header="Status">
          <template #body="{ data }">
            <span v-if="data.name" class="status-chip" :class="classify(data.status)">
              <span class="dot" aria-hidden="true"></span>
              <span class="status-chip-label">{{ data.status }}</span>
            </span>
          </template>
        </p-column>
        <p-column :frozen="false" header="">
          <template #body="{ data }">
            <i v-if="data.name" class="pi pi-chevron-right row-arrow" aria-hidden="true"></i>
          </template>
        </p-column>
      </p-datatable>

      <div class="empty-state" v-if="!rows.length">
        <svg class="empty-silhouette" viewBox="0 0 72 40" aria-hidden="true">
          <rect x="6" y="4" width="30" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M46 16 h18 v8 h-18 v-8 M46 8 h18" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M0 32 h72" opacity="0.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M0 36 h72" opacity="0.4" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <span>no containers anywhere</span>
      </div>
    </div>
  </section>
</template>

<script>
import { defineComponent } from 'vue';
import { api, ApiError } from '../lib/api.js';

function classify(status = '') {
  const s = String(status);
  if (/^Up/.test(s)) return 'up';
  if (/^Restarting/.test(s)) return 'warn';
  return 'down';
}

const SILHOUETTE = null; // empty-state SVG is inline in the template

export default defineComponent({
  data: () => ({
    rows: [],
    daemons: [],
    users: [],
    error: '',
  }),
  computed: {
    daemonTotal() {
      return this.daemons.length;
    },
    daemonUp() {
      return this.daemons.filter((d) => d.state === 'up').length;
    },
    containerCount() {
      return this.rows.filter((r) => r.name).length;
    },
  },
  methods: {
    async load() {
      this.error = '';
      try {
        const { containers, daemons } = await api.containers();
        this.daemons = daemons;
        const meta = Object.fromEntries(daemons.map((d) => [d.user, d]));
        const byUser = new Map();
        for (const c of containers) {
          const bucket = byUser.get(c.user) ?? [];
          bucket.push(c);
          byUser.set(c.user, bucket);
        }
        const rows = [];
        for (const user of this.users) {
          const mine = byUser.get(user.name);
          const state = meta[user.name]?.state;
          if (mine?.length) rows.push(...mine);
          else if (state) rows.push({ __empty: true, user: user.name, daemonDown: state === 'down' });
        }
        this.rows = rows;
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : String(e);
      }
    },
    async loadUsers() {
      try {
        this.users = await api.users();
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : String(e);
      }
    },
    classify,
    shortId: (id) => (id || '').slice(0, 8),
    shelfLabel: (u) => (u === 'root' ? 'admin' : u),
    shelfUid(u) {
      const found = this.users.find((x) => x.name === u);
      return found ? `#${found.uid}` : '';
    },
    daemonState(u) {
      return this.daemons.find((d) => d.user === u)?.state ?? '';
    },
    shelfHint(u) {
      const mine = this.rows.filter((r) => r.user === u && r.name);
      const d = this.daemons.find((x) => x.user === u);
      if (d?.state === 'down') return 'daemon unreachable';
      return mine.length ? `${mine.length} running` : 'idle';
    },
    open(row) {
      if (row.__empty) return;
      this.$router.push(`/containers/${row.user}/${row.name}`);
    },
  },
  async mounted() {
    await this.loadUsers();
    await this.load();
  },
});
</script>