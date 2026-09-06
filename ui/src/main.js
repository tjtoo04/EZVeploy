import { createApp } from "vue";
import PrimeVue from "primevue/config";
import { primevueSetup, makeRouter } from "./setup.js";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Dropdown from "primevue/select";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import Toast from "primevue/toast";
import Message from "primevue/message";
import App from "./App.vue";

import "./assets/main.css";

const router = makeRouter();
const app = createApp(App);
app.use(router);
app.use(PrimeVue, primevueSetup);

const components = [
  ["p-datatable", DataTable],
  ["p-column", Column],
  ["p-select", Dropdown],
  ["p-inputtext", InputText],
  ["p-button", Button],
  ["p-toast", Toast],
  ["p-message", Message],
];
for (const [name, comp] of components) {
  app.component(name, comp);
}

app.mount("#app");
