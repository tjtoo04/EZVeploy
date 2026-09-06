<template>
  <section aria-label="Add domain">
    <header class="page-head">
      <h1 class="page-title">Add Domain</h1>
      <span class="mono-tag page-meta">provisions at the front proxy → a tenant's edge port</span>
      <div class="page-actions">
        <p-button icon="pi pi-refresh" label="Refresh list" size="small" @click="load" />
      </div>
    </header>

    <div class="domain-card">
      <h2>Add a domain</h2>
      <div class="field">
        <label class="field-label" for="domain-input">domain</label>
        <p-inputtext
          id="domain-input"
          v-model="form.domain"
          placeholder="example.com · *.cdn.example.com"
          spellcheck="false"
          @keyup.enter="submit"
        />
      </div>
      <div class="field">
        <label class="field-label" for="owner-select">owner</label>
        <p-select
          id="owner-select"
          v-model="form.user"
          :options="users"
          option-value="name"
          option-label="name"
          placeholder="pick the tenant user"
          :show-clear="false"
        />
      </div>
      <p-message v-if="error" severity="error" :closable="false" class="form-error">{{ error }}</p-message>
      <div class="form-ok" v-if="submitted">
        <span class="ok-check" aria-hidden="true">✓</span>
        <span class="mono">{{ submitted.domain }} → {{ submitted.user }} · {{ submitted.lastResult }}</span>
      </div>
      <div class="row">
        <p-button
          label="Provision"
          icon="pi pi-plus"
          :loading="inFlight"
          :disabled="inFlight"
          class="p-button-lg"
          @click="submit"
        />
        <span class="mono-tag hint">{{ users.length }} tenants</span>
      </div>
    </div>

    <div class="domains-list">
      <h2 class="log-panel-title">provisioned domains</h2>
      <p-datatable
        :value="domains"
        :show-gridlines="false"
        empty-message="no domains provisioned yet"
      >
        <p-column field="domain" header="Domain">
          <template #body="{ data }">
            <span class="cell-name">{{ data.domain }}</span>
          </template>
        </p-column>
        <p-column field="user" header="Owner">
          <template #body="{ data }">
            <span class="cell-name owner">{{ data.user }}</span>
          </template>
        </p-column>
        <p-column field="createdAt" header="Added">
          <template #body="{ data }">
            <span class="cell-image">{{ data.createdAt }}</span>
          </template>
        </p-column>
        <p-column field="lastResult" header="Script output">
          <template #body="{ data }">
            <span class="cell-image" :title="data.lastResult">{{ data.lastResult }}</span>
          </template>
        </p-column>
      </p-datatable>
    </div>
  </section>
</template>

<script>
import { defineComponent } from 'vue';
import { api, ApiError } from '../lib/api.js';

// Mirrors server-side rules (server/src/lib/domains-validate.js).
const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function normalize(raw) {
  let d = String(raw ?? '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const slash = d.indexOf('/');
  if (slash >= 0) d = d.slice(0, slash);
  return d.replace(/\.+$/, '');
}

export default defineComponent({
  data: () => ({
    users: [],
    domains: [],
    form: { domain: '', user: null },
    error: '',
    inFlight: false,
    submitted: null,
  }),
  methods: {
    async load() {
      try {
        const [users, domains] = await Promise.all([api.users(), api.domains()]);
        this.users = users;
        this.domains = domains;
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : String(e);
      }
    },
    async submit() {
      if (this.inFlight) return;
      const domain = normalize(this.form.domain);
      const user = this.form.user;
      if (!domain) return (this.error = 'domain is required');
      if (domain.length > 253 || !DOMAIN_RE.test(domain)) {
        this.error = 'invalid domain — letters, digits, hyphens and dots only; a leading *. wildcard is allowed';
        return;
      }
      if (!user) return (this.error = 'pick the owning user');
      this.error = '';
      this.submitted = null;
      this.inFlight = true;
      try {
        const rec = await api.createDomain({ domain, user });
        this.submitted = rec;
        this.form = { domain: '', user: null };
        await this.loadDomainsOnly();
      } catch (e) {
        const apiErr = e instanceof ApiError ? e : null;
        this.error = apiErr
          ? `${apiErr.message}${apiErr.body?.output ? ' — ' + apiErr.body.output : ''}`
          : String(e);
      } finally {
        this.inFlight = false;
      }
    },
    async loadDomainsOnly() {
      this.domains = await api.domains();
    },
  },
  async mounted() {
    await this.load();
  },
});
</script>