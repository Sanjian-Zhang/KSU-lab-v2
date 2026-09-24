import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";

export default defineConfig({
  site: "https://www.intelligentbiomechanicslab.net",
  integrations: [
    icon(),
    sitemap({
      filter: (page) => !page.includes("/admin") && !page.includes("/membersALT/"),
      changefreq: "weekly",
      priority: 0.7,
    }),
  ],
});
