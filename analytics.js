/*
 * NAPL — CLOUDFLARE WEB ANALYTICS
 */

(function () {
    const beacon = document.createElement("script");

    beacon.type = "module";
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";

    beacon.setAttribute(
        "data-cf-beacon",
        JSON.stringify({
            token: "7aa60a7d4725497699189f26ae707758"
        })
    );

    document.head.appendChild(beacon);
})();
