<template>
  <section aria-label="Container observability">
    <nav class="crumbs">
      <RouterLink to="/" class="crumbs-link">
        <i class="pi pi-arrow-left" aria-hidden="true"></i> back to the wall
      </RouterLink>
    </nav>

    <header class="page-head">
      <h1 class="page-title">{{ userName }}</h1>
      <span class="page-title sub">{{ containerName }}</span>
      <span class="mono-tag page-meta">docker logs — latest lines</span>
      <div class="page-actions">
        <p-button icon="pi pi-refresh" label="Refresh stats" size="small" @click="loadStats" />
      </div>
    </header>

    <p-message v-if="error" severity="error" :closable="false" class="error-band">{{ error }}</p-message>

    <div class="stat-strip" v-if="!error && stats">
      <div class="stat-chip">
        <span class="stat-value">{{ stats.cpu ?? '—' }}{{ stats.cpu != null ? '%' : '' }}</span>
        <span class="stat-label">CPU</span>
      </div>
      <div class="stat-chip">
        <span class="stat-value">{{ fmtBytes(stats.memUsed) }}</span>
        <span class="stat-label">memory used</span>
      </div>
      <div class="stat-chip">
        <span class="stat-value">{{ fmtBytes(stats.memLimit) }}</span>
        <span class="stat-label">memory limit</span>
      </div>
      <div class="stat-chip">
        <span class="stat-value">{{ stats.memPct ?? '—' }}{{ stats.memPct != null ? '%' : '' }}</span>
        <span class="stat-label">memory of limit</span>
      </div>
    </div>

    <div class="log-panel" v-if="!error">
      <div class="log-panel-head">
        <h2 class="log-panel-title">logs</h2>
        <span class="mono-tag" :class="{ reconnecting }">
          {{ following ? 'following live' : 'snapshot' }}{{ frozen ? ' · frozen on last line' : '' }}{{ reconnecting ? ' · reconnecting…' : '' }}
        </span>
        <div class="log-tools follow-toggle">
          <p-button
            :label="following ? 'Pause' : 'Follow'"
            :icon="following ? 'pi pi-pause' : 'pi pi-play'"
            size="small"
            @click="toggleFollow"
          />
        </div>
      </div>
      <div
        class="log-view"
        ref="logView"
        :class="{ frozen }"
        tabindex="0"
        aria-label="container logs"
        @scroll="onScroll"
      >
        <div v-if="!lines.length" class="log-empty">— no log lines yet</div>
        <div v-for="(l, i) in lines" :key="i" class="log-line">{{ l }}</div>
      </div>
    </div>
  </section>
</template>

<script>
import { defineComponent } from 'vue';
import { api, ApiError, followLogs } from '../lib/api.js';

function fmtBytes(v) {
  return v || '—'; // docker already reports "12.5 MiB" — pass through
}

export default defineComponent({
  data: () => ({
    stats: null,
    lines: [],
    error: '',
    following: true,
    frozen: false,
    reconnecting: false,
    stopFollow: null,
  }),
  computed: {
    userName() {
      return this.$route.params.user;
    },
    containerName() {
      return this.$route.params.name;
    },
  },
  methods: {
    fmtBytes,
    async loadStats() {
      try {
        this.stats = await api.stats(this.userName, this.containerName);
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : String(e);
      }
    },
    async loadTail() {
      try {
        const text = await api.logs(this.userName, this.containerName, 200);
        this.lines = (text || '').split('\n').filter((l) => l !== '');
      } catch (e) {
        this.error = e instanceof ApiError ? e.message : String(e);
        return false;
      }
      return true;
    },
    toggleFollow() {
      this.following = !this.following;
      this.startFollow();
    },
    startFollow() {
      this.stopFollow?.();
      this.stopFollow = null;
      if (!this.following) return;
      this.stopFollow = followLogs(this.userName, this.containerName, {
        lines: 100,
        onLog: (raw) => {
          try {
            const line = JSON.parse(raw);
            this.lines.push(line);
            if (this.lines.length > 800) this.lines.splice(0, this.lines.length - 800);
            this.scrollToBottom();
          } catch {
            /* malformed event — ignore one line */
          }
        },
        onError: (raw) => (this.error = raw),
        onReconnect: () => (this.reconnecting = true),
      });
    },
    scrollToBottom() {
      const el = this.$refs.logView;
      if (!el || this.frozen) return;
      el.scrollTop = el.scrollHeight;
    },
    onScroll() {
      const el = this.$refs.logView;
      if (!el) return;
      this.frozen = el.scrollHeight - el.scrollTop - el.clientHeight > 24;
    },
  },
  async mounted() {
    const ok = await this.loadTail();
    if (ok) {
      await this.loadStats();
      this.startFollow();
    }
  },
  beforeUnmount() {
    this.stopFollow?.();
  },
});
</script>