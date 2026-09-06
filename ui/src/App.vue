<!--
  THE BOX WALL — direction contract (concept-seed 3bc44096, candidate 6).
  THESIS: one admin's whole VPS as a lit box wall — board exterior, tissue
  interiors; container rows are end labels, tenants are shelves, status is a
  colorway chip. Refuses the generic cloud-dashboard default.
  OWN-WORLD: burnt-orange board + paper ink + tissue-white interiors;
  condensed caps over monospaced size-runs; one-line silhouettes.
  STORY: the admin reads who runs what at a glance, pulls a box out
  (logs/stats), adds a domain — no SSH.
  FIRST VIEWPORT: masthead shelf; wall of tenant shelves holding tissue rows
  of container end labels; row hover slides the box forward (orange spine).
  FORM: sneaker archive wall (assigned by concept-seed 3bc44096), built inside
  the pinned stack — PrimeVue supplies behavior, the world the surface.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, and DESIGN.md.
-->
<template>
  <div class="ez-shell">
    <header class="masthead">
      <RouterLink to="/" class="brand">
        <svg class="brand-mark" viewBox="0 0 48 24" aria-hidden="true">
          <path
            d="M4 4 H44 M4 20 H44 M6 4 V20 M42 4 V20 M30 4 L30 8 M34 4 L34 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          ></path>
        </svg>
        <span class="brand-name">EZVeploy</span>
        <span class="brand-tag">root panel</span>
      </RouterLink>
      <nav class="tabnav" aria-label="Primary">
        <div class="tabnav-item" :class="{ active: isActive('/') }">
          <RouterLink to="/"><i class="pi pi-box"></i><span>Containers</span></RouterLink>
        </div>
        <div class="tabnav-item" :class="{ active: isActive('/domains') }">
          <RouterLink to="/domains"><i class="pi pi-globe"></i><span>Add Domain</span></RouterLink>
        </div>
      </nav>
      <div class="masthead-session">
        <span v-if="fixtureMode" class="mono-tag warn">fixture data</span>
        <span class="ctl" aria-hidden="true"></span>
        <span class="mono">session: root</span>
      </div>
    </header>
    <main class="stage">
      <RouterView />
    </main>
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import { api } from './lib/api.js';

export default defineComponent({
  data: () => ({ fixtureMode: false }),
  methods: {
    isActive(path) {
      return this.$route.path === path || this.$route.path.startsWith(path + '/');
    },
  },
  async mounted() {
    try {
      this.fixtureMode = (await api.health()).mode === 'fixture';
    } catch {
      /* health is best-effort — the panel still renders */
    }
  },
});
</script>