import { createRouter, createWebHistory } from "vue-router";
import { ezveployTheme } from "./theme.mjs";

export const primevueSetup = {
  theme: { preset: ezveployTheme, options: { darkModeSelector: "system" } },
  ripple: false,
};

export function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: () => import("./views/ContainersView.vue") },
      { path: "/domains", component: () => import("./views/DomainsView.vue") },
      {
        path: "/containers/:user/:name",
        component: () => import("./views/ContainerView.vue"),
      },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
}
