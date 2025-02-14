import { connect } from "cloudflare:sockets";

const proxyListURL = 'https://raw.githubusercontent.com/jaka2m/botak/refs/heads/main/cek/proxyList.txt';
const namaWeb = 'MOCHVPN PROJECT'
const telegramku = 'https://t.me/budijoi'
const wildcards = [
  'ava.game.naver.com',
  'business.blibli.com',
   'graph.instagram.com',
   'quiz.int.vidio.com',
   'live.iflix.com',
   'support.zoom.us',
   'blog.webex.com',
   'investors.spotify.com',
   'cache.netflix.com',
   'zaintest.vuclip.com',
   'ads.ruangguru.com',
   'api.midtrans.com',
];
// Global Variables
let cachedProxyList = [];
let proxyIP = "";

// Constants
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

async function getProxyList(forceReload = false) {
  if (!cachedProxyList.length || forceReload) {
    if (!proxyListURL) {
      throw new Error("No Proxy List URL Provided!");
    }

    const proxyBank = await fetch(proxyListURL);
    if (proxyBank.status === 200) {
      const proxyString = ((await proxyBank.text()) || "").split("\n").filter(Boolean);
      cachedProxyList = proxyString
        .map((entry) => {
          const [proxyIP, proxyPort, country, org] = entry.split(",");
          return {
            proxyIP: proxyIP || "Unknown",
            proxyPort: proxyPort || "Unknown",
            country: country.toUpperCase() || "Unknown",
            org: org || "Unknown Org",
          };
        })
        .filter(Boolean);
    }
  }

  return cachedProxyList;
}

async function reverseProxy(request, target) {
  const targetUrl = new URL(request.url);
  targetUrl.hostname = target;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

  return newResponse;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");
      const CHECK_API_BASE = env.CHECK_API_BASE; // Get base URL from secrets
      const CHECK_API = `${CHECK_API_BASE}/check?ip=`;
      
      // Handle IP check
      if (url.pathname === "/geo-ip") {
        const ip = url.searchParams.get("ip");

        if (!ip) {
          return new Response("IP parameter is required", { status: 400 });
        }

        // Call external API using CHECK_API
        const apiResponse = await fetch(`${CHECK_API}${ip}`);
        if (!apiResponse.ok) {
          return new Response("Failed to fetch IP information", { status: apiResponse.status });
        }

        const data = await apiResponse.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      }      

      // Map untuk menyimpan proxy per country code
      const proxyState = new Map();

      // Fungsi untuk memperbarui proxy setiap menit
      async function updateProxies() {
        const proxies = await getProxyList(env);
        const groupedProxies = groupBy(proxies, "country");

        for (const [countryCode, proxies] of Object.entries(groupedProxies)) {
          const randomIndex = Math.floor(Math.random() * proxies.length);
          proxyState.set(countryCode, proxies[randomIndex]);
        }

        console.log("Proxy list updated:", Array.from(proxyState.entries()));
      }

      // Jalankan pembaruan proxy setiap menit
      ctx.waitUntil(
        (async function periodicUpdate() {
          await updateProxies();
          setInterval(updateProxies, 60000); // Setiap 60 detik
        })()
      );

      if (upgradeHeader === "websocket") {
        // Match path dengan format /CC atau /CCangka
        const pathMatch = url.pathname.match(/^\/([A-Z]{2})(\d+)?$/);

        if (pathMatch) {
          const countryCode = pathMatch[1];
          const index = pathMatch[2] ? parseInt(pathMatch[2], 10) - 1 : null;

          console.log(`Country Code: ${countryCode}, Index: ${index}`);

          // Ambil proxy berdasarkan country code
          const proxies = await getProxyList(env);
          const filteredProxies = proxies.filter((proxy) => proxy.country === countryCode);

          if (filteredProxies.length === 0) {
            return new Response(`No proxies available for country: ${countryCode}`, { status: 404 });
          }

          let selectedProxy;

          if (index === null) {
            // Ambil proxy acak dari state jika ada
            selectedProxy = proxyState.get(countryCode) || filteredProxies[0];
          } else if (index < 0 || index >= filteredProxies.length) {
            return new Response(
              `Index ${index + 1} out of bounds. Only ${filteredProxies.length} proxies available for ${countryCode}.`,
              { status: 400 }
            );
          } else {
            selectedProxy = filteredProxies[index];
          }

          proxyIP = `${selectedProxy.proxyIP}:${selectedProxy.proxyPort}`;
          console.log(`Selected Proxy: ${proxyIP}`);
          return await websockerHandler(request);
        }

        // Match path dengan format ip:port atau ip=port
        const ipPortMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (ipPortMatch) {
          proxyIP = ipPortMatch[1].replace(/[=:-]/, ":"); // Standarisasi menjadi ip:port
          console.log(`Direct Proxy IP: ${proxyIP}`);
          return await websockerHandler(request, proxyIP);
        }
      }
      
      const geovpn = url.hostname;
      const type = url.searchParams.get('type') || 'mix';
      const tls = url.searchParams.get('tls') !== 'false';
      const wildcard = url.searchParams.get('wildcard') === 'true';
      const bugs = url.searchParams.get('bug') || geovpn;
      const geo81 = wildcard ? `${bugs}.${geovpn}` : geovpn;
      const country = url.searchParams.get('country');
      const limit = parseInt(url.searchParams.get('limit'), 10); // Ambil nilai limit
      let configs;

      switch (url.pathname) {
        case '/vpn/clash':
          configs = await generateClashSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/surfboard':
          configs = await generateSurfboardSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/singbox':
          configs = await generateSingboxSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/husi':
          configs = await generateHusiSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/nekobox':
          configs = await generateNekoboxSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/v2rayng':
          configs = await generateV2rayngSub(type, bugs, geo81, tls, country, limit);
          break;
        case '/vpn/v2ray':
          configs = await generateV2raySub(type, bugs, geo81, tls, country, limit);
          break;
        case "/web":
          return await handleWebRequest(request);
          break;
        case "/vpn":
          return new Response(await handleSubRequest(url.hostname), { headers: { 'Content-Type': 'text/html' } });
        case "/":
          // Konten untuk root dengan pengalihan otomatis ke /web setelah 3 detik
          return new Response(
            `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>MOCHVPN - Your Ultimate VPN Solution</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap" rel="stylesheet">
  <noscript>
      <style amp-boilerplate>
        body {
          -webkit-animation: none;
          -moz-animation: none;
          -ms-animation: none;
          animation: none;
        }
      </style>
    </noscript>
    <style amp-custom>
      * {
        box-sizing: border-box;
      }

      body {
        background-color: #000;
        color: #fff;
        font-family: rubik, sans-serif;
      }

      header {
        background-color: #000;
        box-shadow: 0 0 9px 2px hsl(0deg 0% 4% / 48%);
      }

      header .header-wrapper {
        margin: 0 auto;
        max-width: 960px;
      }

      header .header-wrapper .logo {
        display: flex;
        justify-content: center;
        position: relative;
        padding: 5px 0;
      }

      h1,
      h2,
      h3 {
        color: #75ccff;
      }

      nav {
        background-color: #222;
        border-bottom: 5px solid #C11B17;
      }

      nav .menu {
        position: relative;
      }

      nav .menu ul {
        list-style-type: none;
        position: relative;
        margin: 0;
        padding: 0;
      }

      nav .menu ul li {
        color: #fff;
        display: inline-block;
      }

      nav .menu ul li a {
        color: #fff;
        text-decoration: none;
        padding: 10px 15px;
        display: inline-block;
      }

      .active {
        background: -webkit-linear-gradient(top, #353535 0%, #333333 100%);
      }

      .container {
        margin: 0 auto;
        max-width: 960px;
      }

      .content {
        margin: 5px 0;
        padding: 5px;
      }

      .text-center {
        text-align: center;
      }

      .title {
        background-color: #222;
        padding: 15px;
        font-size: 17px;
      }

      .thumbs {
        position: relative;
        padding-top: 5px;
      }

      .btn-body {
        margin: 15px 0;
        position: relative;
        display: flex;
      }

      .btn-body .btn-items {
        margin: 0 5px;
        width: 100%;
      }

      .btn-body .btn-items a {
        text-decoration: none;
        width: 100%;
        padding: 10px 5px;
        color: #fff;
        background: -webkit-linear-gradient(top, hsl(0, 0%, 33%) 0%, #1a1a1a 100%);
        border-radius: 5px;
        display: inline-block;
        text-align: center;overflow: hidden;position: relative;
      }.btn-body .btn-items a::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;width: 100%;
        height: 100%;
        background-color: #ad8585;
        opacity: 0;
        -webkit-transition: 0.2s opacity ease-in-out;
        transition: 0.2s opacity ease-in-out;
      }

      .btn-items a span {
        position: absolute;
      }

      .btn-items a span:nth-child(1) {
        top: 0;
        left: 0;
        width: 100%;
        height: 3px;
        background: -webkit-gradient(linear, left bottom, left top, from(rgba(43, 8, 8, 0)), to(#0f0));
        background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
        -webkit-animation: 2s animateTop linear -1s infinite;
        animation: 2s animateTop linear -1s infinite;
      }

      .btn-items a span:nth-child(2) {
        top: 0;
        right: 0;
        height: 100%;
        width: 2px;
        background: -webkit-gradient(linear, left bottom, left top, from(rgba(43, 8, 8, 0)), to(#0f0));
        background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
        -webkit-animation: 2s animateRight linear -1s infinite;
        animation: 2s animateRight linear -1s infinite;
      }

      .btn-items a span:nth-child(3) {
        bottom: 0;
        left: 0;
        width: 100%;
        height: 3px;
        background: -webkit-gradient(linear, left top, right top, from(rgba(43, 8, 8, 0)), to(#0f0));
        background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
        -webkit-animation: 2s animateBottom linear infinite;
        animation: 2s animateBottom linear infinite;
      }

      .btn-items a span:nth-child(4) {
        top: 0;
        left: 0;
        height: 100%;
        width: 2px;
        background: -webkit-gradient(linear, left top, left bottom, from(rgba(43, 8, 8, 0)), to(#0f0));
        background: linear-gradient(45deg, #ff0000, #ff7300, #fffb00, #48ff00, #00ffd5, #002bff, #7a00ff, #ff00c8, #ff0000);
        -webkit-animation: 2s animateLeft linear -1s infinite;
        animation: 2s animateLeft linear -1 infinite;
      }

      .box-games-wrapper {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
      }

      .box-games-wrapper .box-games {
        width: 150px;
        margin: 15px 5px;
      }

      .box-games-wrapper .box-games .games-img {
        position: relative;
        overflow: hidden;
        padding: 7px;
      }

      .box-games-wrapper .box-games .games-name {
        font-size: 12px;
        background-color: #222;
        padding: 10px 5px;
        text-align: center;
        font-weight: 500;
      }

      .box-text {
        padding: 5px;
      }

      .box-text a {
        text-decoration: none;
        color: hsl(214, 100%, 67%);
      }

      .content table {
        width: 100%;
        border-collapse: collapse;
      }

      .box-text table {
        width: 100%;
        text-align: center;
        border-collapse: separate;
        border: 1px solid #fff;
      }

      .content table th,
      .content table td {
        padding: 8px;
        border: 1px solid #41e718;
      }

      .content table th {
        background: #41e718 linear-gradient(180deg, #000000, #C11B17) repeat-x;
        text-shadow: 0 1px 3px rgb(0 0 0 / 75%);
      }

      .content table {
        width: 100%;
        border-collapse: collapse;
      }

      .box-text table th,
      td {
        border: 1px solid #fff;
        padding: 5px;
      }

      .mt-50 {
        margin-top: 50px;
      }

      footer {
        padding: 15px 5px;
      }

      .copyleft {
    text-decoration:none;
    color:#fff;
    margin:50px 0;
    }
    .copyleft a {
    color:#FFFF00;
    }
    .acenter {
    text-align:center
    }
    .pb-2 {
    padding-bottom:.2rem
    }

    .fixed-footer {
    display:flex;
    justify-content:space-around;
    position:fixed;
    background:radial-gradient(circle 214px at 49.5% 54.2%,#201a1a 0,#C11B17 96%);
    padding:5px 0;
    left:0;
    right:0;
    bottom:0;
    z-index:99
  }
  .fixed-footer a {
    flex-basis:calc((100% - 15px*6)/ 5);
    display:flex;
    flex-direction:column;
    justify-content:center;
    align-items:center;
    color:#080202;
    max-width:75px;
    font-size:12px
  }
  .fixed-footer .center {
    transform:scale(1.5) translateY(-5px);
    background:center no-repeat;
    background-size:contain;
    background-color:inherit;
    border-radius:50%
  }
  .fixed-footer amp-img {
    max-width:30%;
    margin-bottom:5px
  }

  .tada {
    -webkit-animation-name:tada;
    animation-name:tada;
    -webkit-animation-duration:1s;
    animation-duration:1s;
    -webkit-animation-fill-mode:both;
    animation-fill-mode:both;
    animation-iteration-count:infinite
  }
  @-webkit-keyframes tada {
    0% {
      -webkit-transform:scale3d(1,1,1);
      transform:scale3d(1,1,1)
    }
    10%,20% {
      -webkit-transform:scale3d(.9,.9,.9) rotate3d(0,0,1,-3deg);
      transform:scale3d(.9,.9,.9) rotate3d(0,0,1,-3deg)
    }
    30%,50%,70%,90% {
      -webkit-transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg);
      transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg)
    }
    40%,60%,80% {
      -webkit-transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg);
      transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg)
    }
    100% {
      -webkit-transform:scale3d(1,1,1);
      transform:scale3d(1,1,1)
    }
  }
  @keyframes tada {
    0% {
      -webkit-transform:scale3d(1,1,1);
      transform:scale3d(1,1,1)
    }
    10%,20% {
      -webkit-transform:scale3d(.9,.9,.9) rotate3d(0,0,1,-3deg);
      transform:scale3d(.9,.9,.9) rotate3d(0,0,1,-3deg)
    }
    30%,50%,70%,90% {
      -webkit-transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg);
      transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,3deg)
    }
    40%,60%,80% {
      -webkit-transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg);
      transform:scale3d(1.1,1.1,1.1) rotate3d(0,0,1,-3deg)
    }
    100% {
      -webkit-transform:scale3d(1,1,1);
      transform:scale3d(1,1,1)
    }
  }

      @keyframes beat {
        to {
          transform: scale(1.2);
        }
      }

      @keyframes animateTop {
        0% {
          -webkit-transform: translateX(100%);
          transform: translateX(100%);
        }

        100% {
          -webkit-transform: translateX(-100%);
          transform: translateX(-100%);
        }
      }

      @keyframes animateRight {
        0% {
          -webkit-transform: translateY(100%);
          transform: translateY(100%);
        }

        100% {
          -webkit-transform: translateY(-100%);
          transform: translateY(-100%);
        }
      }

      @keyframes animateLeft {
        0% {
          -webkit-transform: translateY(-100%);
          transform: translateY(-100%);
        }

        100% {
          -webkit-transform: translateY(100%);
          transform: translateY(100%);
        }
      }

      @keyframes animateBottom {
        0% {
          -webkit-transform: translateX(-100%);
          transform: translateX(-100%);
        }

        100% {
          -webkit-transform: translateX(100%);
          transform: translateX(100%);
        }
      }

      @media only screen and (max-width: 720px) {
        .box-games-wrapper {
          justify-content: center;
        }

        .box-games-wrapper .box-games {
          width: 45%;
        }

        nav .menu ul li {
          display: block;
          text-align: center;
        }

        nav .menu ul li a {
          width: 100%;
        }
    </style>
    <script async custom-element="amp-analytics" src="https://cdn.ampproject.org/v0/amp-analytics-0.1.js"></script>
  </head>
  
  <script>
    setTimeout(() => {
      window.location.href = "/web";
    }, 7000);
  </script>
</head>
  <body>
    <header>
      <div class="header-wrapper">
        <div class="logo">
        </div>
      </div>
    </header>
    <nav role="navigation">
      <div class="container">
        <div class="menu">
          <ul>
            <li>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
    <section class="content">
      <div class="container">
        <div class="thumbs">
          <amp-img src="https://www.nimbusddos.com/img/animations/cloud-based-ddos-simulation-platform.gif" width="200" height="90" alt="XCDDOS VPS MURAH" layout="responsive"></amp-img>
        </div>
        <nav role="navigation">
      <div class="container">
        <div class="menu">
          <ul>
            <li>
<div class="btn-body">
                                              <div class="btn-items">
              </a>
                        <a href="https://t.me/testikuy_mang" class="active">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
                 <b>     🔈LIST VPS PREMIUM INTEL CPUs⚡</b>
                              </a>
              <a href="https://t.me/testikuy_mang" class="active">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
                 <b>     🔈LIST VPS PREMIUM AMD CPUs⚡</b>
                              </a>
                        <a href="https://t.me/testikuy_mang" class="active">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
                 <b>     🔈LIST VPS REGULAR CPUs⚡</b>
                              </a>
                                                        </div>
                                                      </div>
            </li>
          </ul>
        </div>
      </div>
    </nav>
        <div class="btn-body">
          <div class="btn-items">
            <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>512 MB / 1 CPU
10 GB SSD Disk
500 GB transfer <br>🛒<br> Rp.15k/1$</b>
            </a>
            <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>1 GB / 1 CPU
25 GB SSD Disk
1000 GB transfer <br>🛒<br> Rp.25k/2$</b>
            </a>
                        <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>2 GB / 1 CPU
50 GB SSD Disk
2 TB transfer <br>🛒<br> Rp.45k/3$</b>
            </a>
                        <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>2 GB / 2 CPUs
60 GB SSD Disk
3 TB transfer

 <br>🛒<br> Rp.60k/4$</b>
            </a>
          <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>4 GB / 2 CPUs
80 GB SSD Disk
4 TB transfer <br>🛒<br> Rp.70k/5$</b>
            </a>
            <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>8 GB / 4 CPUs
160 GB SSD Disk
5 TB transfer <br>🛒<br> Rp.70k/9$</b>
            </a>
            <a href="https://t.me/testikuy_mang" rel="nofollow noreferrer" target="_blank" title="CLICK TO ORDER VPS">
              <b>16 GB / 8 CPUs
320 GB SSD Disk
6 TB transfer <br>🛒<br> Rp.200k/16$</b>
            </a>
          </div>
        </div>
        <section class="content">
          <table>
            <tbody>
              <tr>
                <th colspan="2">INFO SITUS VPS BERKUALITAS TERPERCAYA</th>
              </tr>
              <tr>
                <td>Proof Transaction / Bukti Trx</td>
                <td><a href="https://t.me/testikuy_mang">Click Here To Check</a> 🔥</td>
              </tr>
              <tr>
                <td>Payment</td>
                <td>📱QRIS, ⭐Paypal</td>
              </tr>
              <tr>
                <td>Mata Uang</td>
                <td>IDR (Indonesia Rupiah) && ALL PAYMENT</td>
              </tr>
              <tr>
                <td>Jam Operasional</td>
                <td>24 Jam Online</td>
              </tr>
              <tr>
                <td>Card Pembelian</td>
                <td>Full Garansi 30 Days 3x Replace</td>
              </tr>
              <tr>
                <td>Rating</td>
                <td>⭐⭐⭐⭐⭐⭐</td>
              </tr>
            </tbody>
          </table>
        </section>
        <style>
        .contact-icons {
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 9999;
        }

        .contact-icons a {
            margin-right: 10px;
        }

        .contact-icons img {
            width: 40px;
            height: auto;
        }
    </style>
    <div class="contact-icons">
        <a href="https://t.me/sampiiiiu" target="_blank">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/83/Telegram_2019_Logo.svg" alt="Telegram Icon">
        </a>
    </div>
    <article>
      <div class="container">
        <div class="box-text">
        <footer>
        <div class="container">
                        <div class="copyleft acenter pb-2">
                            <span>Copyright &copy; 2015 - 2070 • <a href="https://t.me/sampiiiiu">GEO PROJECT CORPORATION</a> •</span>
                        </div>
    </article>
  </body>
</html>

`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        default:
          const targetReverseProxy = "example.com";
          return await reverseProxy(request, targetReverseProxy);
      }

      return new Response(configs);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
      });
    }
  },
};

// Helper function: Group proxies by country
function groupBy(array, key) {
  return array.reduce((result, currentValue) => {
    (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
    return result;
  }, {});
}

async function handleSubRequest(hostnem) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sub Link</title>
    <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        :root {
    --color-primary: #00ff88;
    --color-secondary: #00ffff;
    --color-background: #0a0f1a;
    --color-card: rgba(0, 0, 0, 0); /* Kartu sepenuhnya transparan */
    --color-text: #e0f4f4;
    --transition: all 0.3s ease;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    outline: none;
}

body {
    font-family: 'Inter', sans-serif;
    background: url('https://telegra.ph/file/0b9a4c97f231c8bc33aa9.jpg') no-repeat center center fixed;
    background-size: cover;
    color: var(--color-text);
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 1rem;
}

.container {
    width: 100%;
    max-width: 500px;
    padding: 2rem;
}

.card {
    background: var(--color-card);
    border-radius: 16px;
    padding: 2rem;
    box-shadow: 0 10px 30px rgba(0, 255, 136, 0.1);
    backdrop-filter: blur(15px); /* Efek blur latar belakang */
    border: 1px solid rgba(0, 255, 136, 0.2); /* Border transparan */
    transition: var(--transition);
    -webkit-backdrop-filter: blur(15px); /* Untuk Safari */
    background-color: rgba(0, 0, 0, 0); /* Menghapus latar belakang solid */
}

.card:hover {
    transform: scale(1.02);
}

.title {
    text-align: center;
    color: var(--color-primary);
    margin-bottom: 1.5rem;
    font-size: 2rem;
    font-weight: 700;
}

.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--color-text);
    font-weight: 500;
}

.form-control {
    width: 100%;
    padding: 0.75rem 1rem;
    background: rgba(0, 255, 136, 0.1);
    border: 2px solid rgba(0, 255, 136, 0.3);
    border-radius: 8px;
    color: var(--color-text);
    transition: var(--transition);
}

.form-control:focus {
    border-color: var(--color-secondary);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.4);
}

.btn {
    width: 100%;
    padding: 0.75rem;
    background: var(--color-primary);
    color: var(--color-background);
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
}

.btn:hover {
    background: var(--color-secondary);
}

.result {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(0, 255, 136, 0.1);
    border-radius: 8px;
    word-break: break-all;
}

.loading {
    display: none;
    text-align: center;
    color: var(--color-primary);
    margin-top: 1rem;
}

.copy-btns {
    display: flex;
    justify-content: space-between;
    margin-top: 0.5rem;
}

.copy-btn {
    background: rgba(0, 255, 136, 0.2);
    color: var(--color-primary);
    padding: 0.5rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: var(--transition);
}

.copy-btn:hover {
    background: rgba(0, 255, 136, 0.3);
}

#error-message {
    color: #ff4444;
    text-align: center;
    margin-top: 1rem;
}

.watermark {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 1rem;
        color: #00FFFF;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        font-weight: bold;
        text-align: center;
      }
    
    .watermark a {
        color: #00FFFF;
        text-decoration: none;
        font-weight: bold;
      }
    
      .watermark a:hover {
        color: #00FFFF;
      }
    
      @media (max-width: 768px) {
        .header h1 { font-size: 32px; }
        .config-section h3 { font-size: 24px; }
        .config-block h4 { font-size: 20px; }
      }
      
      .watermark-container {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  font-size: 17px;
  font-weight: bold;
  z-index: 9999;
  color: #ff0000;
  background: rgba(255, 0, 0, 0.1);
  padding: 5px 15px;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.watermark-container a {
  color: #ff0000;
  text-decoration: none;
}

.watermark-container a:hover {
  text-decoration: underline;
}

.separator {
  margin: 0 10px; /* Jarak antara teks */
}

    </style>
</head>
<body>
    <div class="container">
    <div class="card">
        <h1 class="title">Geo Project</h1>
       <center>
    <button id="home-button" 
        class="px-3 py-1 text-sm font-semibold text-white border border-[#39ff14] rounded-md backdrop-blur-md bg-white/10 hover:bg-white/20 hover:text-black transition duration-300 ease-in-out"
        style="margin-top: 0.4rem;" 
        onclick="window.location.href='/web';">
        Back Home
    </button>
</center>
<br>
            <form id="subLinkForm">
                <div class="form-group">
                    <label for="app">Aplikasi</label>
                    <select id="app" class="form-control" required>
                        <option value="v2ray">V2RAY</option>
                        <option value="v2rayng">V2RAYNG</option>
                        <option value="clash">CLASH</option>
                        <option value="nekobox">NEKOBOX</option>
                        <option value="singbox">SINGBOX</option>
                        <option value="surfboard">SURFBOARD</option>
                        <option value="husi">HUSI</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="bug">Bug</label>
                    <input type="text" id="bug" class="form-control" placeholder="Contoh: quiz.int.vidio.com" required>
                </div>

                <div class="form-group">
                    <label for="configType">Tipe Config</label>
                    <select id="configType" class="form-control" required>
                        <option value="vless">VLESS</option>
                        <option value="trojan">TROJAN</option>
                        <option value="ss">SHADOWSOCKS</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="tls">TLS</label>
                    <select id="tls" class="form-control">
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="wildcard">Wildcard</label>
                    <select id="wildcard" class="form-control">
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="country">Negara</label>
                    <select id="country" class="form-control">
                        <option value="all">ALL COUNTRY</option>
                        <option value="RANDOM">RANDOM</option>
    <option value="SG">Singapore</option>
    <option value="US">United States</option>
    <option value="AF">Afghanistan</option>
    <option value="AL">Albania</option>
    <option value="DZ">Algeria</option>
    <option value="AS">American Samoa</option>
    <option value="AD">Andorra</option>
    <option value="AO">Angola</option>
    <option value="AI">Anguilla</option>
    <option value="AR">Argentina</option>
    <option value="AM">Armenia</option>
    <option value="AW">Aruba</option>
    <option value="AU">Australia</option>
    <option value="AT">Austria</option>
    <option value="AZ">Azerbaijan</option>
    <option value="BS">Bahamas</option>
    <option value="BH">Bahrain</option>
    <option value="BD">Bangladesh</option>
    <option value="BB">Barbados</option>
    <option value="BY">Belarus</option>
    <option value="BE">Belgium</option>
    <option value="BZ">Belize</option>
    <option value="BJ">Benin</option>
    <option value="BM">Bermuda</option>
    <option value="BT">Bhutan</option>
    <option value="BO">Bolivia</option>
    <option value="BA">Bosnia and Herzegovina</option>
    <option value="BW">Botswana</option>
    <option value="BR">Brazil</option>
    <option value="IO">British Indian Ocean Territory</option>
    <option value="BN">Brunei Darussalam</option>
    <option value="BG">Bulgaria</option>
    <option value="BF">Burkina Faso</option>
    <option value="BI">Burundi</option>
    <option value="KH">Cambodia</option>
    <option value="CM">Cameroon</option>
    <option value="CA">Canada</option>
    <option value="CV">Cape Verde</option>
    <option value="KY">Cayman Islands</option>
    <option value="CF">Central African Republic</option>
    <option value="TD">Chad</option>
    <option value="CL">Chile</option>
    <option value="CN">China</option>
    <option value="CX">Christmas Island</option>
    <option value="CC">Cocos (Keeling) Islands</option>
    <option value="CO">Colombia</option>
    <option value="KM">Comoros</option>
    <option value="CG">Congo</option>
    <option value="CD">Congo (Democratic Republic)</option>
    <option value="CK">Cook Islands</option>
    <option value="CR">Costa Rica</option>
    <option value="HR">Croatia</option>
    <option value="CU">Cuba</option>
    <option value="CY">Cyprus</option>
    <option value="CZ">Czech Republic</option>
    <option value="CI">Côte d'Ivoire</option>
    <option value="DK">Denmark</option>
    <option value="DJ">Djibouti</option>
    <option value="DM">Dominica</option>
    <option value="DO">Dominican Republic</option>
    <option value="EC">Ecuador</option>
    <option value="EG">Egypt</option>
    <option value="SV">El Salvador</option>
    <option value="GQ">Equatorial Guinea</option>
    <option value="ER">Eritrea</option>
    <option value="EE">Estonia</option>
    <option value="ET">Ethiopia</option>
    <option value="FK">Falkland Islands</option>
    <option value="FO">Faroe Islands</option>
    <option value="FJ">Fiji</option>
    <option value="FI">Finland</option>
    <option value="FR">France</option>
    <option value="GF">French Guiana</option>
    <option value="PF">French Polynesia</option>
    <option value="TF">French Southern Territories</option>
    <option value="GA">Gabon</option>
    <option value="GM">Gambia</option>
    <option value="GE">Georgia</option>
    <option value="DE">Germany</option>
    <option value="GH">Ghana</option>
    <option value="GI">Gibraltar</option>
    <option value="GR">Greece</option>
    <option value="GL">Greenland</option>
    <option value="GD">Grenada</option>
    <option value="GP">Guadeloupe</option>
    <option value="GU">Guam</option>
    <option value="GT">Guatemala</option>
    <option value="GG">Guernsey</option>
    <option value="GN">Guinea</option>
    <option value="GW">Guinea-Bissau</option>
    <option value="GY">Guyana</option>
    <option value="HT">Haiti</option>
    <option value="HN">Honduras</option>
    <option value="HK">Hong Kong</option>
    <option value="HU">Hungary</option>
    <option value="IS">Iceland</option>
    <option value="IN">India</option>
    <option value="ID">Indonesia</option>
    <option value="IR">Iran</option>
    <option value="IQ">Iraq</option>
    <option value="IE">Ireland</option>
    <option value="IL">Israel</option>
    <option value="IT">Italy</option>
    <option value="JM">Jamaica</option>
    <option value="JP">Japan</option>
    <option value="JE">Jersey</option>
    <option value="JO">Jordan</option>
    <option value="KZ">Kazakhstan</option>
    <option value="KE">Kenya</option>
    <option value="KI">Kiribati</option>
    <option value="KW">Kuwait</option>
    <option value="KG">Kyrgyzstan</option>
    <option value="LA">Laos</option>
    <option value="LV">Latvia</option>
    <option value="LB">Lebanon</option>
    <option value="LS">Lesotho</option>
    <option value="LR">Liberia</option>
    <option value="LY">Libya</option>
    <option value="LI">Liechtenstein</option>
    <option value="LT">Lithuania</option>
    <option value="LU">Luxembourg</option>
    <option value="MO">Macao</option>
    <option value="MK">North Macedonia</option>
    <option value="MG">Madagascar</option>
    <option value="MW">Malawi</option>
    <option value="MY">Malaysia</option>
    <option value="MV">Maldives</option>
    <option value="ML">Mali</option>
    <option value="MT">Malta</option>
    <option value="MH">Marshall Islands</option>
    <option value="MQ">Martinique</option>
    <option value="MR">Mauritania</option>
    <option value="MU">Mauritius</option>
    <option value="YT">Mayotte</option>
    <option value="MX">Mexico</option>
    <option value="FM">Micronesia</option>
    <option value="MD">Moldova</option>
    <option value="MC">Monaco</option>
    <option value="MN">Mongolia</option>
    <option value="ME">Montenegro</option>
    <option value="MS">Montserrat</option>
    <option value="MA">Morocco</option>
    <option value="MZ">Mozambique</option>
    <option value="MM">Myanmar</option>
    <option value="NA">Namibia</option>
    <option value="NR">Nauru</option>
    <option value="NP">Nepal</option>
    <option value="NL">Netherlands</option>
    <option value="NC">New Caledonia</option>
    <option value="NZ">New Zealand</option>
    <option value="NI">Nicaragua</option>
    <option value="NE">Niger</option>
    <option value="NG">Nigeria</option>
    <option value="NU">Niue</option>
    <option value="NF">Norfolk Island</option>
    <option value="KP">North Korea</option>
    <option value="MP">Northern Mariana Islands</option>
    <option value="NO">Norway</option>
    <option value="OM">Oman</option>
    <option value="PK">Pakistan</option>
    <option value="PW">Palau</option>
    <option value="PA">Panama</option>
    <option value="PG">Papua New Guinea</option>
    <option value="PY">Paraguay</option>
    <option value="PE">Peru</option>
    <option value="PH">Philippines</option>
    <option value="PL">Poland</option>
    <option value="PT">Portugal</option>
    <option value="PR">Puerto Rico</option>
    <option value="QA">Qatar</option>
    <option value="RE">Réunion</option>
    <option value="RO">Romania</option>
    <option value="RU">Russia</option>
    <option value="RW">Rwanda</option>
    <option value="BL">Saint Barthélemy</option>
    <option value="SH">Saint Helena</option>
    <option value="KN">Saint Kitts and Nevis</option>
    <option value="LC">Saint Lucia</option>
    <option value="MF">Saint Martin</option>
    <option value="PM">Saint Pierre and Miquelon</option>
    <option value="VC">Saint Vincent and the Grenadines</option>
    <option value="WS">Samoa</option>
    <option value="SM">San Marino</option>
    <option value="SA">Saudi Arabia</option>
    <option value="SN">Senegal</option>
    <option value="RS">Serbia</option>
    <option value="SC">Seychelles</option>
    <option value="SL">Sierra Leone</option>
    <option value="SG">Singapore</option>
    <option value="SX">Sint Maarten</option>
    <option value="SK">Slovakia</option>
    <option value="SI">Slovenia</option>
    <option value="SB">Solomon Islands</option>
    <option value="SO">Somalia</option>
    <option value="ZA">South Africa</option>
    <option value="KR">South Korea</option>
    <option value="SS">South Sudan</option>
    <option value="ES">Spain</option>
    <option value="LK">Sri Lanka</option>
    <option value="SD">Sudan</option>
    <option value="SR">Suriname</option>
    <option value="SJ">Svalbard and Jan Mayen</option>
    <option value="SE">Sweden</option>
    <option value="CH">Switzerland</option>
    <option value="SY">Syria</option>
    <option value="TW">Taiwan</option>
    <option value="TJ">Tajikistan</option>
    <option value="TZ">Tanzania</option>
    <option value="TH">Thailand</option>
    <option value="TL">Timor-Leste</option>
    <option value="TG">Togo</option>
    <option value="TK">Tokelau</option>
    <option value="TO">Tonga</option>
    <option value="TT">Trinidad and Tobago</option>
    <option value="TN">Tunisia</option>
    <option value="TR">Turkey</option>
    <option value="TM">Turkmenistan</option>
    <option value="TC">Turks and Caicos Islands</option>
    <option value="TV">Tuvalu</option>
    <option value="UG">Uganda</option>
    <option value="UA">Ukraine</option>
    <option value="AE">United Arab Emirates</option>
    <option value="GB">United Kingdom</option>
    <option value="US">United States</option>
    <option value="UY">Uruguay</option>
    <option value="UZ">Uzbekistan</option>
    <option value="VU">Vanuatu</option>
    <option value="VE">Venezuela</option>
    <option value="VN">Vietnam</option>
    <option value="WF">Wallis and Futuna</option>
    <option value="EH">Western Sahara</option>
    <option value="YE">Yemen</option>
    <option value="ZM">Zambia</option>
    <option value="ZW">Zimbabwe</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="limit">Jumlah Config</label>
                    <input type="number" id="limit" class="form-control" min="1" max="50" placeholder="Maks 50" required>
                </div>

                <button type="submit" class="btn">Generate Sub Link</button>
            </form>

            <div id="loading" class="loading">Generating Link...</div>
            <div id="error-message"></div>

            <div id="result" class="result" style="display: none;">
                <p id="generated-link"></p>
                <div class="copy-btns">
                    <button id="copyLink" class="copy-btn">Copy</button>
                    <button id="openLink" class="copy-btn">Open</button>
                </div>
            </div>
        </div>
    </div>
<div class="watermark-container">
  <a href="https://t.me/VLTRSSbot" target="_blank">VPNBot</a>
  <span class="separator">-</span>
  <a href="https://t.me/sampiiiiu" target="_blank">GeoVPN</a>
</div>

    <script>
        // Performance optimization: Use event delegation and minimize DOM queries
        document.addEventListener('DOMContentLoaded', () => {
            const form = document.getElementById('subLinkForm');
            const loadingEl = document.getElementById('loading');
            const resultEl = document.getElementById('result');
            const generatedLinkEl = document.getElementById('generated-link');
            const copyLinkBtn = document.getElementById('copyLink');
            const openLinkBtn = document.getElementById('openLink');
            const errorMessageEl = document.getElementById('error-message');
            const appSelect = document.getElementById('app');
            const configTypeSelect = document.getElementById('configType');

            // Cached selectors to minimize DOM lookups
            const elements = {
                app: document.getElementById('app'),
                bug: document.getElementById('bug'),
                configType: document.getElementById('configType'),
                tls: document.getElementById('tls'),
                wildcard: document.getElementById('wildcard'),
                country: document.getElementById('country'),
                limit: document.getElementById('limit')
            };

            // App and config type interaction
            appSelect.addEventListener('change', () => {
                const selectedApp = appSelect.value;
                const shadowsocksOption = configTypeSelect.querySelector('option[value="shadowsocks"]');
                
                if (selectedApp === 'surfboard') {
                    configTypeSelect.value = 'trojan';
                    configTypeSelect.querySelector('option[value="trojan"]').selected = true;
                    shadowsocksOption.disabled = true;
                } else {
                    shadowsocksOption.disabled = false;
                }
            });

            // Form submission handler
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // Reset previous states
                loadingEl.style.display = 'block';
                resultEl.style.display = 'none';
                errorMessageEl.textContent = '';

                try {
                    // Validate inputs
                    const requiredFields = ['bug', 'limit'];
                    for (let field of requiredFields) {
                        if (!elements[field].value.trim()) {
                            throw new Error(\`Harap isi \${field === 'bug' ? 'Bug' : 'Jumlah Config'}\`);
                        }
                    }

                    // Construct query parameters
                    const params = new URLSearchParams({
                        type: elements.configType.value,
                        bug: elements.bug.value.trim(),
                        tls: elements.tls.value,
                        wildcard: elements.wildcard.value,
                        limit: elements.limit.value,
                        ...(elements.country.value !== 'all' && { country: elements.country.value })
                    });

                    // Generate full link (replace with your actual domain)
                    const generatedLink = \`/vpn/\${elements.app.value}?\${params.toString()}\`;

                    // Simulate loading (remove in production)
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Update UI
                    loadingEl.style.display = 'none';
                    resultEl.style.display = 'block';
                    generatedLinkEl.textContent = \`https://\${window.location.hostname}\${generatedLink}\`;

                    // Copy link functionality
                    copyLinkBtn.onclick = async () => {
    try {
        const link = 'https://' + window.location.hostname + generatedLink;
        await navigator.clipboard.writeText(link);

        Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            width: '270px',
            text: 'Link berhasil disalin ke clipboard!',
            background: 'rgba(6, 18, 67, 0.70)',
                        color: 'white',
                        timer: 1500,
                        showConfirmButton: false
        });
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Gagal!',
            text: 'Gagal menyalin link.',
            confirmButtonText: 'Coba Lagi',
        });
        console.error(error);
    }
};


                    // Open link functionality
                    openLinkBtn.onclick = () => {
                        window.open(generatedLink, '_blank');
                    };

                } catch (error) {
                    // Error handling
                    loadingEl.style.display = 'none';
                    errorMessageEl.textContent = error.message;
                    console.error(error);
                }
            });
        });
    </script>
</body>
</html>
 `
return html
}

async function handleWebRequest(request) {
    const apiUrl = proxyListURL;

    const fetchConfigs = async () => {
      try {
        const response = await fetch(apiUrl);
        const text = await response.text();
        
        let pathCounters = {};

        const configs = text.trim().split('\n').map((line) => {
          const [ip, port, countryCode, isp] = line.split(',');
          
          if (!pathCounters[countryCode]) {
            pathCounters[countryCode] = 1;
          }
          const path = `/${countryCode}${pathCounters[countryCode]}`;
          pathCounters[countryCode]++;

          return { ip, port, countryCode, isp, path };
        });

        return configs;
      } catch (error) {
        console.error('Error fetching configurations:', error);
        return [];
      }
    };

    const generateUUIDv4 = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

function buildCountryFlag() {
  const flagList = cachedProxyList.map((proxy) => proxy.country);
  const uniqueFlags = new Set(flagList);

  let flagElement = "";
  for (const flag of uniqueFlags) {
    if (flag && flag !== "Unknown") {
      try {
        flagElement += `<a href="/web?page=${page}&search=${flag}" class="py-1">
      <img width="35"
        style="bg-dark margin-right: 8px; border: 3px solid transparent; border-radius: 50%; box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1); flex-shrink: 0; max-width: 55px; max-height: 55px; background: linear-gradient(90deg, #39ff14, #008080); border-image: linear-gradient(90deg, #39ff14, #008080) 1;"
        src="https://installer.us.kg/circle-flags/flags/${flag.toLowerCase()}.svg" />
        </a>`;
      } catch (err) {
        console.error(`Error generating flag for country: ${flag}`, err);
      }
    }
  }

  return flagElement;
}

    const getFlagEmoji = (countryCode) => {
      if (!countryCode) return '🏳️';
      return countryCode
        .toUpperCase()
        .split('')
        .map((char) => String.fromCodePoint(0x1f1e6 - 65 + char.charCodeAt(0)))
        .join('');
    };

    const url = new URL(request.url);
    const hostName = url.hostname;
    const page = parseInt(url.searchParams.get('page')) || 1;
    const searchQuery = url.searchParams.get('search') || '';
    const selectedWildcard = url.searchParams.get('wildcard') || '';
    const selectedConfigType = url.searchParams.get('configType') || 'tls'; // Ambil nilai 'configType' atau gunakan default 'tls'
    const configsPerPage = 30;

    const configs = await fetchConfigs();
    const totalConfigs = configs.length;

    let filteredConfigs = configs;
    if (searchQuery.includes(':')) {
        // Search by IP:PORT format
        filteredConfigs = configs.filter((config) => 
            `${config.ip}:${config.port}`.includes(searchQuery)
        );
    } else if (searchQuery.length === 2) {
        // Search by country code (if it's two characters)
        filteredConfigs = configs.filter((config) =>
            config.countryCode.toLowerCase().includes(searchQuery.toLowerCase())
        );
    } else if (searchQuery.length > 2) {
        // Search by IP, ISP, or country code
        filteredConfigs = configs.filter((config) =>
            config.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (`${config.ip}:${config.port}`).includes(searchQuery.toLowerCase()) ||
            config.isp.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }
     
    const totalFilteredConfigs = filteredConfigs.length;
    const totalPages = Math.ceil(totalFilteredConfigs / configsPerPage);
    const startIndex = (page - 1) * configsPerPage;
    const endIndex = Math.min(startIndex + configsPerPage, totalFilteredConfigs);
    const visibleConfigs = filteredConfigs.slice(startIndex, endIndex);

    const configType = url.searchParams.get('configType') || 'tls';

    const tableRows = visibleConfigs
      .map((config) => {
        const uuid = generateUUIDv4();
        const wildcard = selectedWildcard || hostName;
        const modifiedHostName = selectedWildcard ? `${selectedWildcard}.${hostName}` : hostName;
        const url = new URL(request.url);
       const BASE_URL = `https://${url.hostname}`; 
       const CHECK_API = `${BASE_URL}/geo-ip?ip=`; 
        const ipPort = `${config.ip}:${config.port}`;
        const healthCheckUrl = `${CHECK_API}${ipPort}`;

        if (configType === 'tls') {
            return `
                <tr class="config-row">
                    <td class="ip-cell">${config.ip}:${config.port}</td>
                    <td class="proxy-status" id="status-${ipPort}"><strong><i class="fas fa-spinner fa-spin loading-icon"></i></strong><div class="rainbow-text">Loading...</div></td>
                    <td class="border border-gray-700 px-1 py-1 text-center">
                        <img width="40" src="https://installer.us.kg/circle-flags/flags/${config.countryCode.toLowerCase()}.svg" class="ms-2 rounded">
                        </td>
                    <td class="country-cell">${config.countryCode} | ${config.isp}</td>
                    <td class="path-cell">${config.path}</td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`vless://${uuid}@${wildcard}:443?encryption=none&security=tls&sni=${modifiedHostName}&fp=randomized&type=ws&host=${modifiedHostName}&path=${encodeURIComponent(config.path.toUpperCase())}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            VLESS
                        </button>
                    </td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`trojan://${uuid}@${wildcard}:443?encryption=none&security=tls&sni=${modifiedHostName}&fp=randomized&type=ws&host=${modifiedHostName}&path=${encodeURIComponent(config.path.toUpperCase())}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            TROJAN
                        </button>
                    </td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`ss://${btoa(`none:${uuid}`)}%3D@${wildcard}:443?encryption=none&type=ws&host=${modifiedHostName}&path=${encodeURIComponent(config.path.toUpperCase())}&security=tls&sni=${modifiedHostName}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            Shadowsocks
                        </button>
                    </td>
                </tr>

<script>
          fetch('${healthCheckUrl}')
            .then(response => response.json())
            .then(data => {
              const statusElement = document.getElementById('status-${ipPort}');
              const spinner = document.getElementById('ping-' + data.proxy + ':' + data.port);

      // Ambil data status dan delay
            const status = data.status || 'UNKNOWN';
            let delay = parseFloat(data.delay) || 'N/A';

            console.log("Status:", status);
            console.log("Raw delay:", data.delay);
            console.log("Parsed delay:", delay);

            const divisor = 4; 

            if (!isNaN(delay)) {
                delay = Math.round(delay / divisor);
                console.log("Processed delay:", delay);  // Debugging log
            }

            if (status === 'ACTIVE') {
                statusElement.innerHTML = 'ACTIVE<br><span style="fas fa-bolt"></i>&nbsp;<span style="color: gold;">(' + delay + 'ms)</span>'; 
                statusElement.style.color = '#00FF00';
                statusElement.style.fontSize = '13px';
                statusElement.style.fontWeight = 'bold';
            } else if (status === 'DEAD') {
                statusElement.innerHTML = '<strong><i class="fas fa-times-circle"></i> DEAD</strong>';
                statusElement.style.color = '#FF3333';
                statusElement.style.fontSize = '13px';
                statusElement.style.fontWeight = 'bold';
            }
        })
        .catch(error => {
              const statusElement = document.getElementById('status-${ipPort}');
              statusElement.textContent = 'Error';
              statusElement.style.color = 'cyan';
            });
        </script>

`;
        } else {
            return `
                <tr class="config-row">
                    <td class="ip-cell">${config.ip}:${config.port}</td>
                    <td class="proxy-status" id="status-${ipPort}"><strong><i class="fas fa-spinner fa-spin loading-icon"></i></strong><div class="rainbow-text">Loading...</div></td>
                    <td class="border border-gray-700 px-1 py-1 text-center">
                        <img width="40" src="https://installer.us.kg/circle-flags/flags/${config.countryCode.toLowerCase()}.svg" class="ms-2 rounded">
                        </td>
                    <td class="country-cell">${config.countryCode} | ${config.isp}</td>
                    <td class="path-cell">${config.path}</td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`vless://${uuid}@${wildcard}:80?path=${encodeURIComponent(config.path.toUpperCase())}&security=none&encryption=none&host=${modifiedHostName}&fp=randomized&type=ws&sni=${modifiedHostName}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            VLESS
                        </button>
                    </td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`trojan://${uuid}@${wildcard}:80?path=${encodeURIComponent(config.path.toUpperCase())}&security=none&encryption=none&host=${modifiedHostName}&fp=randomized&type=ws&sni=${modifiedHostName}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            TROJAN
                        </button>
                    </td>
                    <td class="button-cell">
                        <button class="px-3 py-1 bg-gradient-to-r from-[#39ff14] to-[#008080] text-black font-semibold border-0 rounded-md transform transition hover:scale-105" onclick="copy('${`ss://${btoa(`none:${uuid}`)}%3D@${wildcard}:80?encryption=none&type=ws&host=${modifiedHostName}&path=${encodeURIComponent(config.path.toUpperCase())}&security=none&sni=${modifiedHostName}#(${config.countryCode})%20${config.isp.replace(/\s/g,'%20')}${getFlagEmoji(config.countryCode)}`}')">
                            Shadowsocks
                        </button>
                    </td>
                </tr>
<script>
          fetch('${healthCheckUrl}')
            .then(response => response.json())
            .then(data => {
              const statusElement = document.getElementById('status-${ipPort}');
              const spinner = document.getElementById('ping-' + data.proxy + ':' + data.port);

      // Ambil data status dan delay
            const status = data.status || 'UNKNOWN';
            let delay = parseFloat(data.delay) || 'N/A';

            console.log("Status:", status);
            console.log("Raw delay:", data.delay);
            console.log("Parsed delay:", delay);

            const divisor = 4; 

            if (!isNaN(delay)) {
                delay = Math.round(delay / divisor);
                console.log("Processed delay:", delay);  // Debugging log
            }

            if (status === 'ACTIVE') {
                statusElement.innerHTML = 'ACTIVE<br><span style="fas fa-bolt"></i>&nbsp;<span style="color: gold;">(' + delay + 'ms)</span>'; 
                statusElement.style.color = '#00FF00';
                statusElement.style.fontSize = '13px';
                statusElement.style.fontWeight = 'bold';
            } else if (status === 'DEAD') {
                statusElement.innerHTML = '<strong><i class="fas fa-times-circle"></i> DEAD</strong>';
                statusElement.style.color = '#FF3333';
                statusElement.style.fontSize = '13px';
                statusElement.style.fontWeight = 'bold';
            }
        })
        .catch(error => {
              const statusElement = document.getElementById('status-${ipPort}');
              statusElement.textContent = 'Error';
              statusElement.style.color = 'cyan';
            });
        </script>

`;
        }
      })
      .join('');

    const paginationButtons = [];
    const pageRange = 2;

    for (let i = Math.max(1, page - pageRange); i <= Math.min(totalPages, page + pageRange); i++) {
      paginationButtons.push(
        `<a href="?page=${i}&wildcard=${encodeURIComponent(selectedWildcard)}&configType=${encodeURIComponent(selectedConfigType)}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''}" class="pagination-number ${i === page ? 'active' : ''}">${i}</a>`
      );
    }

    const prevPage = page > 1
      ? `<a href="?page=${page - 1}&wildcard=${encodeURIComponent(selectedWildcard)}&configType=${encodeURIComponent(selectedConfigType)}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''}" class="pagination-arrow">◁</a>`
      : '';

    const nextPage = page < totalPages
      ? `<a href="?page=${page + 1}&wildcard=${encodeURIComponent(selectedWildcard)}&configType=${encodeURIComponent(selectedConfigType)}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''}" class="pagination-arrow">▷</a>`
      : '';

  return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FREE | VPN | CLOUDFLARE</title>
    <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root {
        --primary: #00ff88;
        --secondary: #00ffff;
        --accent: #ff00ff;
        --dark: #080c14;
        --darker: #040608;
        --light: #e0ffff;
        --card-bg: rgba(8, 12, 20, 0.95);
        --glow: 0 0 20px rgba(0, 255, 136, 0.3);
      }
      
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: 'Space Grotesk', sans-serif;
      }

      body {
  background: var(--darker);
  color: var(--light);
  min-height: 85vh;
  background-image: 
    radial-gradient(circle at 0% 0%, rgba(0, 255, 136, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 100% 100%, rgba(0, 255, 255, 0.1) 0%, transparent 50%),
    url('https://telegra.ph/file/0b9a4c97f231c8bc33aa9.jpg');
  background-size: cover;
  background-attachment: fixed;
  background-position: center;
}

      .wildcard-dropdown {
  display: flex;
  justify-content: center; /* Posisi elemen di tengah */
  align-items: center; /* Posisi vertikal di tengah */
  gap: 0.5rem; /* Jarak antar elemen */
  margin: 0.5rem auto; /* Jarak vertikal */
  width: 100%; /* Ambil seluruh lebar */
  max-width: 100%; /* Hindari pembatasan */
  padding: 0.5rem; /* Tambahkan padding */
  box-sizing: border-box; /* Padding termasuk dalam ukuran elemen */
}

.wildcard-dropdown select {
  flex: 1; /* Setiap dropdown mengambil ruang secara proporsional */
  max-width: 48%; /* Batasi lebar dropdown agar tidak terlalu besar */
  min-width: 100px; /* Tambahkan batas minimum untuk dropdown */
}

@media (min-width: 768px) {
  .wildcard-dropdown select {
    max-width: 300px; /* Pada layar besar, tetapkan batas lebar dropdown */
  }
}

      select {
        width: 100%;
        max-width: 200px; /* Lebar box lebih kecil */
        padding: 0.4rem 0.6rem; /* Sesuaikan padding */
        font-size: 0.8rem; /* Ukuran teks lebih kecil */
        color: var(--light);
        background: rgba(0, 255, 136, 0.05);
        border: 2px solid rgba(0, 255, 136, 0.3);
        border-radius: 10px;
        box-shadow: var(--glow);
        outline: none;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        appearance: none; /* Hilangkan panah default */
        background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23e0ffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M6 9l6 6 6-6"%3E%3C/path%3E%3C/svg%3E');
        background-position: right 10px center;
        background-repeat: no-repeat;
        background-size: 1rem;
        transition: all 0.3s ease;
      }

      select:hover {
        border-color: var(--primary);
        box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
      }

      select:focus {
        border-color: var(--secondary);
        background: rgba(0, 255, 136, 0.1);
        box-shadow: 0 0 20px var(--secondary);
      }

      .button-style {
    padding: 0.6rem 1rem; /* Ukuran padding */
    font-family: 'Rajdhani', sans-serif; /* Font */
    font-weight: 600; /* Ketebalan font */
    font-size: 0.6rem; /* Ukuran font */
    color: var(--dark); /* Warna teks */
    background: var(--primary); /* Warna background */
    border: none; /* Hilangkan border */
    border-radius: 5px; /* Kurangi radius untuk sudut lebih tajam */
    cursor: pointer; /* Ubah kursor saat hover */
    transition: all 0.3s ease; /* Efek transisi */
    text-transform: uppercase; /* Teks kapitalisasi */
    letter-spacing: 1px; /* Jarak antar huruf */
    position: relative; /* Relatif untuk animasi */
    overflow: hidden; /* Sembunyikan elemen overflow */
    display: flex; /* Flexbox */
    align-items: center; /* Ratakan secara vertikal */
    justify-content: center; /* Ratakan secara horizontal */
    gap: 0.5rem; /* Jarak antar elemen */
}

      .button-style::before {
        content: ''; /* Pseudo-element */
        position: absolute; /* Posisi absolut */
        top: 0;
        left: -100%; /* Mulai dari luar */
        width: 100%; /* Lebar penuh */
        height: 100%; /* Tinggi penuh */
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.2),
          transparent
        ); /* Efek gradient */
        transition: 0.5s; /* Durasi transisi */
      }

      .button-style:hover::before {
        left: 100%; /* Gerakkan gradient ke kanan */
       }

      .button-style:hover {
        transform: translateY(-2px); /* Efek hover */
        box-shadow: 0 5px 15px rgba(0, 255, 136, 0.3); /* Bayangan */
      }

      .button-style:active {
        transform: translateY(1px); /* Efek klik */
        box-shadow: 0 3px 10px rgba(0, 255, 136, 0.2); /* Reduksi bayangan */
      }

      .quantum-container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 2rem;
        perspective: 1000px;
      }

      .quantum-card {
  max-width: 100%;
  background: var(--card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(0, 255, 136, 0.2);
  border-radius: 20px;
  padding: 2rem;
  margin: 0 1rem; /* Tambahkan ruang kiri dan kanan */
  box-shadow: var(--glow);
  transform-style: preserve-3d;
  animation: cardFloat 6s ease-in-out infinite;
}

@media (min-width: 768px) {
  .quantum-card {
    margin: 0 2rem; /* Tambahkan lebih banyak ruang pada layar besar */
  }
}

      .quantum-title {
        font-family: 'Rajdhani', sans-serif;
        font-size: 4rem;
        font-weight: 700;
        text-align: center;
        margin-top: 1rem;
        margin-bottom: 2rem;
        background: linear-gradient(45deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 0 30px rgba(0, 255, 136, 0.5);
        position: relative;
      }

      
      .search-quantum {
        position: relative;
        margin-top: 0.1rem;
        margin-bottom: 0.3rem;
      }

      #search-bar {
    width: 100%;
    padding: 0.6rem 1rem; /* Spasi dalam */
    font-size: 1.8rem; /* Ukuran font diperbesar */
    color: var(--light); /* Warna teks */
    background: rgba(0, 255, 136, 0.05); /* Latar belakang */
    border: 2px solid rgba(0, 255, 136, 0.3); /* Warna border */
    border-radius: 5px; /* Sudut tidak terlalu bulat */
}

      #search-bar:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
        background: rgba(0, 255, 136, 0.1);
      }

      .quantum-table {
        width: 100%;
        min-width: 800px;
        border-collapse: separate;
        border-spacing: 0 8px;
      }

      .quantum-table th {
        background: rgba(0, 255, 136, 0.1);
        color: var(--primary);
        padding: 1.2rem;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        font-size: 1.1rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        border-bottom: 2px solid var(--primary);
        white-space: nowrap;
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .quantum-table td {
        padding: 1rem;
        background: rgba(0, 255, 136, 0.03);
        border: none;
        transition: all 0.3s ease;
      }

      .quantum-table tr {
        transition: all 0.3s ease;
      }

      .quantum-table tr:hover td {
        background: rgba(0, 255, 136, 0.08);
        transform: scale(1.01);
        box-shadow: 0 5px 15px rgba(0, 255, 136, 0.1);
      }

      .copy-btn {
        padding: 0.8rem 1.5rem;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        font-size: 0.9rem;
        color: var(--dark);
        background: var(--primary);
        border: none;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.3s ease;
        text-transform: uppercase;
        letter-spacing: 1px;
        position: relative;
        overflow: hidden;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .copy-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        transition: 0.5s;
      }

      .copy-btn:hover::before {
        left: 100%;
      }

      .copy-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(0, 255, 136, 0.3);
      }

      .btn-icon {
        font-size: 1.2rem;
      }

      .quantum-pagination {
        display: flex;
        justify-content: center;
        gap: 0.8rem;
        margin-top: 2rem;
        flex-wrap: wrap;
      }

      .quantum-pagination a {
        padding: 0.8rem 1.5rem;
        background: rgba(0, 255, 136, 0.1);
        color: var(--primary);
        text-decoration: none;
        border-radius: 12px;
        border: 1px solid rgba(0, 255, 136, 0.3);
        transition: all 0.3s ease;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        min-width: 45px;
        text-align: center;
      }

      .quantum-pagination a:hover,
      .quantum-pagination a.active {
        background: var(--primary);
        color: var(--dark);
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(0, 255, 136, 0.2);
      }

      .quantum-toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        padding: 1rem 2rem;
        background: var(--primary);
        color: var(--dark);
        border-radius: 12px;
        font-family: 'Rajdhani', sans-serif;
        font-weight: 600;
        box-shadow: 0 5px 15px rgba(0, 255, 136, 0.3);
        transform: translateY(100%);
        opacity: 0;
        }

      @keyframes toastSlide {
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      /* Mobile Responsiveness */
      @media (max-width: 768px) {
        .quantum-container {
          padding: 0.5rem;
          margin: 0.5rem;
        }
        
        .quantum-card {
          padding: 1rem;
          margin: 0;
          width: 100%;
          border-radius: 10px;
          max-width: 100%;
        }
    
        .quantum-title {
          font-size: 2rem;
          margin-bottom: 1rem;
        }
    
        #search-bar {
          padding: 0.6rem 1rem;
          font-size: 0.6rem;
        }
    
        .table-wrapper {
          margin: 0.5rem 0;
          padding: 0;
          border-radius: 10px;
          max-height: 60vh; /* Restrict the height of the table */
          overflow-y: auto; /* Allow scrolling within the table */
          background: rgba(0, 255, 136, 0.02);
        }
    
        .quantum-table th,
        .quantum-table td {
          padding: 0.8rem 0.5rem;
          font-size: 0.9rem;
        }
    
        .copy-btn {
          padding: 0.6rem 1rem;
          font-size: 0.8rem;
        }
     
        .quantum-pagination {
          gap: 0.5rem;
          flex-wrap: wrap;
        }
    
        .quantum-pagination a {
          padding: 0.5rem 0.7rem;
          font-size: 0.7rem;
          min-width: 30px;
        }
    
        .quantum-toast {
          left: 1rem;
          right: 1rem;
          bottom: 1rem;
          text-align: center;
        }
      }

      @media (max-width: 480px) {
        .quantum-card {
          padding: 0.5rem;
          max-width: 100%;
        }
    
        .quantum-title {
          font-size: 1.5rem;
        }
    
        .table-wrapper {
          margin: 0.5rem -0.5rem;
          padding: 0 0.5rem;
        }
    
        .quantum-table {
          font-size: 0.8rem;
        }
    
        .copy-btn {
          padding: 0.5rem 0.8rem;
          font-size: 0.7rem;
        }
      }

      .table-wrapper {
        width: 100%;
        max-height: calc(80vh - 200px); /* Atur tinggi maksimal untuk scroll */
        overflow-y: auto; /* Aktifkan scroll vertikal */
        -webkit-overflow-scrolling: touch; /* Lancar di perangkat touch */
        margin: 1rem 0;
        border-radius: 10px;
        background: rgba(0, 255, 136, 0.02);
      }

      .table-wrapper:hover {
        pointer-events: auto; /* Izinkan scroll pada hover */
      }

      /* Perbaikan pada scrollbar */
      .table-wrapper::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .table-wrapper::-webkit-scrollbar-track {
        background: rgba(0, 255, 136, 0.1);
        border-radius: 4px;
      }

      .table-wrapper::-webkit-scrollbar-thumb {
        background: var(--primary);
        border-radius: 4px;
      }

      .table-wrapper::-webkit-scrollbar-thumb:hover {
        background: var(--secondary);
      }
      
      .swal-popup-extra-small-text {
    font-size: 12px; /* Ukuran font untuk seluruh pop-up */
}

.swal-title-extra-small-text {
    font-size: 12px; /* Ukuran font untuk judul */
    font-weight: bold;
}

.swal-content-extra-small-text {
    font-size: 12px; /* Ukuran font untuk teks konten */
}

@keyframes rainbow {
      0% { color: red; }
      14% { color: black; }
      28% { color: black; }
      42% { color: green; }
      57% { color: blue; }
      71% { color: indigo; }
      85% { color: violet; }
      100% { color: red; }
    }
    
      .spinner {
  border: 4px solid #f3f3f3; /* Light grey */
  border-top: 4px solid #3498db; /* Blue */
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
}

     .quantum-container {
  background-color: rgba(0, 0, 0, 0.82);
  flex: 1;
  padding-top: 20px; /* To avoid content being hidden under the header */
  padding-bottom: 20px;
  margin-top: 95px;
  margin-bottom: 50px; /* To avoid content being hidden under the footer */
  padding-left: 10px;
  padding-right: 10px;
  display: flex;
  flex-direction: column;
  max-width: 960px;
  border: 1px solid #fff;
  border-radius: 10px;
  align-items: center;
  position: relative;
  z-index: 1;
  /* Tambahkan efek glow */
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.6), /* Glow putih */
              0 0 30px rgba(0, 150, 255, 0.5);   /* Glow biru */
  
  /* Default untuk HP */
  margin-left: auto;
  margin-right: auto;
}

/* Offset ke kiri untuk layar besar (desktop) */
@media (min-width: 768px) {
  .container, .content {
    margin-left: auto; /* Sesuaikan offset ke kiri */
    margin-right: auto;
  }
}
      .quantum-card {
  width: 100%;
    overflow-x: auto; /* Mengaktifkan scroll horizontal */
    margin-bottom: 0px;
    border: 1px solid #000; /* Border dengan warna abu-abu */
    border-radius: 10px; /* Membuat sudut melengkung */
    padding: 0px; /* Memberi jarak antara border dan konten */
    background-color: rgba(0, 0, 0, 0.82); /* Warna latar belakang */
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.6), /* Glow putih */
              0 0 30px rgba(0, 150, 255, 0.5);   /* Glow biru */

}

 .rainbow-text {
      font-size: 15px;
      font-weight: bold;
      animation: rainbow 2s infinite;
    }

     .loading-icon {
    color: #4CAF50; /* Warna untuk ikon spinner */
    font-size: 30px;
}

.loading-text {
    font-size: 18px;
    color: #FF5722; /* Warna untuk teks 'Loading...' */
    margin-left: 10px;
    font-weight: bold; /* Menambahkan ketebalan pada teks */
}

/* Animasi Checkmark */
.check-icon {
  color: green;
  font-size: 20px;
  animation: checkAnim 0.3s ease-in-out;
}

@keyframes checkAnim {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}

/* Animasi X (Error) */
.error-icon {
  color: red;
  font-size: 20px;
  animation: errorAnim 0.3s ease-in-out;
}

@keyframes errorAnim {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}

.watermark-container {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  font-size: 17px;
  font-weight: bold;
  z-index: 9999;
  color: #ff0000;
  background: rgba(255, 0, 0, 0.1);
  padding: 5px 15px;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.watermark-container a {
  color: #ff0000;
  text-decoration: none;
}

.watermark-container a:hover {
  text-decoration: underline;
}

.separator {
  margin: 0 10px; /* Jarak antara teks */
}

            
    </style>
</head>
<body>
    <div class="quantum-container">
    	<div class="quantum-card">
        <h1 class="quantum-title">
              <a href="${telegramku}" target="_blank" rel="noopener noreferrer" style="font-family: 'Rajdhani', sans-serif;">
                ${namaWeb}
              </a>
            </h1>
            
            <div class="search-quantum" style="display: flex; align-items: center; flex-direction: column;">
              <div style="display: flex; width: 100%;"><button class="bg-gradient-to-r from-[#39ff14] to-[#008080] text-[#ffffff] border-2 border-[#39ff14] rounded-md px-2 py-0.5 text-sm transition duration-300 ease-in-out hover:bg-[#008080] hover:text-[#222222]"><a href="/vpn">SUB LINK</a></button>
                <input type="text" 
                  id="search-bar" 
                  placeholder="Search by IP, CountryCode, or ISP"
                  value="${searchQuery}" 
                  style="flex: 1; padding: 7px;"/>
                <button id="search-button" class="bg-gradient-to-r from-[#39ff14] to-[#008080] text-[#ffffff] border-2 border-[#39ff14] rounded-md px-2 py-0.5 text-sm transition duration-300 ease-in-out hover:bg-[#008080] hover:text-[#222222]">Search</button>
              </div>
              ${searchQuery
                ? `<button id="home-button" class="bg-gradient-to-r from-[#39ff14] to-[#008080] text-[#ffffff] border-2 border-[#39ff14] rounded-md px-2 py-0.5 text-sm transition duration-300 ease-in-out hover:bg-[#008080] hover:text-[#222222]" style="margin-top: 0.4rem;" onclick="goToHomePage('${hostName}')">
                  Home Page
                </button>`
                : ''}
            </div>
            <br>
            <div class="wildcard-dropdown">
  <select id="wildcard" name="wildcard" onchange="onWildcardChange(event)">
    <option value="" ${!selectedWildcard ? 'selected' : ''}>No Wildcard</option>
    ${wildcards.map(w => `<option value="${w}" ${selectedWildcard === w ? 'selected' : ''}>${w}</option>`).join('')}
  </select>

  <select id="configType" name="configType" onchange="onConfigTypeChange(event)">
    <option value="tls" ${selectedConfigType === 'tls' ? 'selected' : ''}>TLS</option>
    <option value="non-tls" ${selectedConfigType === 'non-tls' ? 'selected' : ''}>NON TLS</option>
  </select>
</div>
<div 
    class="w-full h-12 overflow-x-auto rounded-2xl px-2 py-1 flex items-center space-x-2 shadow-lg bg-transparent border"
    style="border-image: linear-gradient(to right, #39ff14, #008080) 1; border-width: 1px; border-style: solid;">
    ${buildCountryFlag()}
</div>
  <div class="table-wrapper">
              <table class="quantum-table">
                <thead>
                    <tr>
                        <th>IP:PORT</th>
                        <th>STATUS IP</th>
                        <th>COUNTRY</th>
                        <th>ISP</th>
                        <th>PATH</th>
                        <th>VLESS</th>
                        <th>TROJAN</th>
                        <th>SHADOWSOCKS</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
              </table>
            </div>

            <div class="quantum-pagination">
                ${prevPage}
                ${paginationButtons.join('')}
                ${nextPage}
            </div>
          <!-- Showing X to Y of Z Proxies message -->
          <div style="text-align: center; margin-top: 16px; color: var(--primary); font-family: 'Rajdhani', sans-serif;">
            Showing ${startIndex + 1} to ${endIndex} of ${totalFilteredConfigs} Proxies
            </div>
        </div>
    </div>
    <div class="watermark-container">
  <a href="https://t.me/VLTRSSbot" target="_blank">VPNBot</a>
  <span class="separator">-</span>
  <a href="https://t.me/sampiiiiu" target="_blank">GeoVPN</a>
</div>

<script>
        const updateURL = (params) => {
          const url = new URL(window.location.href);

          params.forEach(({ key, value }) => {
            if (key === 'search' && value) {
              // Reset ke halaman 1 jika parameter pencarian diperbarui
              url.searchParams.set('page', '1');
            }
            if (value) {
              url.searchParams.set(key, value);
            } else {
              url.searchParams.delete(key);
            }
          });

          // Redirect ke URL yang telah diperbarui
          window.location.href = url.toString();
        };

        function goToHomePage(hostName) {
          const homeURL = \`https://\${hostName}/web\`;
          window.location.href = homeURL;
        }
        
        function onWildcardChange(event) {
          updateURL([{ key: 'wildcard', value: event.target.value }]);
        }

        function onConfigTypeChange(event) {
          updateURL([{ key: 'configType', value: event.target.value }]);
        }

        function copy(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            Swal.fire({
                icon: 'success',
                background: 'rgba(6, 18, 67, 0.70)',
                color: 'white',
                title: 'Copied!',
                width: '250px',
                text: text,
                timer: 1500,
                showConfirmButton: false,
                customClass: {
                    popup: 'swal-popup-extra-small-text',
                    title: 'swal-title-extra-small-text',
                    content: 'swal-content-extra-small-text',
                }
            });
        })
        .catch(() => {
            Swal.fire({
                icon: 'error',
                title: 'Oops...',
                text: 'Failed to copy. Please try again!',
            });
        });
}

        function showToast(message, isError = false) {
            const toast = document.createElement('div');
            toast.className = 'quantum-toast';
            toast.textContent = message;
            if (isError) {
                toast.style.background = '#ff3366';
            }
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(100%)';
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        }

        function executeSearch() {
  const query = document.getElementById('search-bar').value.trim();
  if (query) {
    updateURL([{ key: 'search', value: query }]);
  } else {
    Swal.fire({
      title: 'Error',
      width: '270px',
      text: 'Please enter a search term.',
      icon: 'error',
      background: 'rgba(6, 18, 67, 0.70)',
      color: 'white',
      timer: 1500,
      showConfirmButton: false,
      customClass: {
        popup: 'swal-popup-extra-small-text',
        title: 'swal-title-extra-small-text',
        content: 'swal-content-extra-small-text',
      }
    });
  }
}

        document.getElementById('search-bar').addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            executeSearch();
          }
        });

        document.getElementById('search-button').addEventListener('click', executeSearch);
    </script>
</body>
</html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

async function websockerHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let udpStreamWrite = null;
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === "Trojan") {
            protocolHeader = parseTrojanHeader(chunk);
          } else if (protocol === "VLESS") {
            protocolHeader = parseVlessHeader(chunk);
          } else if (protocol === "Shadowsocks") {
            protocolHeader = parseShadowsocksHeader(chunk);
          } else {
            parseVmessHeader(chunk);
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
            } else {
              throw new Error("UDP only support for DNS port 53");
            }
          }

          if (isDNS) {
            const { write } = await handleUDPOutbound(webSocket, protocolHeader.version, log);
            udpStreamWrite = write;
            udpStreamWrite(protocolHeader.rawClientData);
            return;
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const trojanDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (trojanDelimiter[0] === 0x0d && trojanDelimiter[1] === 0x0a) {
      if (trojanDelimiter[2] === 0x01 || trojanDelimiter[2] === 0x03 || trojanDelimiter[2] === 0x7f) {
        if (trojanDelimiter[3] === 0x01 || trojanDelimiter[3] === 0x03 || trojanDelimiter[3] === 0x04) {
          return "Trojan";
        }
      }
    }
  }

  const vlessDelimiter = new Uint8Array(buffer.slice(1, 17));
  // Hanya mendukung UUID v4
  if (arrayBufferToHex(vlessDelimiter).match(/^\w{8}\w{4}4\w{3}[89ab]\w{3}\w{12}$/)) {
    return "VLESS";
  }

  return "Shadowsocks"; // default
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket;
  }

  async function retry() {
    const tcpSocket = await connectAndWrite(
      proxyIP.split(/[:=-]/)[0] || addressRemote,
      proxyIP.split(/[:=-]/)[1] || portRemote
    );
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);

  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function parseVmessHeader(vmessBuffer) {
  // https://xtls.github.io/development/protocols/vmess.html#%E6%8C%87%E4%BB%A4%E9%83%A8%E5%88%86
}

function parseShadowsocksHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for Shadowsocks: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function parseVlessHeader(vlessBuffer) {
  const version = new Uint8Array(vlessBuffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];

  const cmd = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not support, command 01-tcp,02-udp,03-mux`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2: // For Domain
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // For IPv6
      addressLength = 16;
      const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: vlessBuffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function parseTrojanHeader(buffer) {
  const socks5DataBuffer = buffer.slice(58);
  if (socks5DataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid SOCKS5 request data",
    };
  }

  let isUDP = false;
  const view = new DataView(socks5DataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(
        "."
      );
      break;
    case 3: // For Domain
      addressLength = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      );
      break;
    case 4: // For IPv6
      addressLength = 16;
      const dataView = new DataView(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = socks5DataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: socks5DataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close");
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason);
        },
      })
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function handleUDPOutbound(webSocket, responseHeader, log) {
  let isVlessHeaderSent = false;
  const transformStream = new TransformStream({
    start(controller) {},
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength));
        index = index + 2 + udpPakcetLength;
        controller.enqueue(udpData);
      }
    },
    flush(controller) {},
  });
  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch("https://1.1.1.1/dns-query", {
            method: "POST",
            headers: {
              "content-type": "application/dns-message",
            },
            body: chunk,
          });
          const dnsQueryResult = await resp.arrayBuffer();
          const udpSize = dnsQueryResult.byteLength;
          const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            log(`doh success and dns message length is ${udpSize}`);
            if (isVlessHeaderSent) {
              webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
            } else {
              webSocket.send(await new Blob([responseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
              isVlessHeaderSent = true;
            }
          }
        },
      })
    )
    .catch((error) => {
      log("dns udp has error" + error);
    });

  const writer = transformStream.writable.getWriter();

  return {
    write(chunk) {
      writer.write(chunk);
    },
  };
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}
// Fungsi untuk mengonversi countryCode menjadi emoji bendera
const getEmojiFlag = (countryCode) => {
  if (!countryCode || countryCode.length !== 2) return ''; // Validasi input
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map(char => 0x1F1E6 + char.charCodeAt(0) - 65)
  );
};
async function generateClashSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n  servername: ${geo81}` : '';
    const snioo = tls ? `\n  cipher: auto` : '';
    if (type === 'vless') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  server: ${bug}
  port: ${ports}
  type: vless
  uuid: ${UUIDS}${snioo}
  tls: ${tls}
  udp: true
  skip-cert-verify: true
  network: ws${snio}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${geo81}`;
    } else if (type === 'trojan') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  server: ${bug}
  port: 443
  type: trojan
  password: ${UUIDS}
  udp: true
  skip-cert-verify: true
  network: ws
  sni: ${geo81}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${geo81}`;
    } else if (type === 'ss') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  type: ss
  server: ${bug}
  port: ${ports}
  cipher: none
  password: ${UUIDS}
  udp: true
  plugin: v2ray-plugin
  plugin-opts:
    mode: websocket
    tls: ${tls}
    skip-cert-verify: true
    host: ${geo81}
    path: /${proxyHost}=${proxyPort}
    mux: false
    headers:
      custom: ${geo81}`;
    } else if (type === 'mix') {
      bex += `  - ${ispName} vless\n  - ${ispName} trojan\n  - ${ispName} ss\n`;
      conf += `
- name: ${ispName} vless
  server: ${bug}
  port: ${ports}
  type: vless
  uuid: ${UUIDS}
  cipher: auto
  tls: ${tls}
  udp: true
  skip-cert-verify: true
  network: ws${snio}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${geo81}
- name: ${ispName} trojan
  server: ${bug}
  port: 443
  type: trojan
  password: ${UUIDS}
  udp: true
  skip-cert-verify: true
  network: ws
  sni: ${geo81}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${geo81}
- name: ${ispName} ss
  type: ss
  server: ${bug}
  port: ${ports}
  cipher: none
  password: ${UUIDS}
  udp: true
  plugin: v2ray-plugin
  plugin-opts:
    mode: websocket
    tls: ${tls}
    skip-cert-verify: true
    host: ${geo81}
    path: /${proxyHost}=${proxyPort}
    mux: false
    headers:
      custom: ${geo81}`;
    }
  }
  return `#### BY : GEO PROJECT #### 

port: 7890
socks-port: 7891
redir-port: 7892
mixed-port: 7893
tproxy-port: 7895
ipv6: false
mode: rule
log-level: silent
allow-lan: true
external-controller: 0.0.0.0:9090
secret: ""
bind-address: "*"
unified-delay: true
profile:
  store-selected: true
  store-fake-ip: true
dns:
  enable: true
  ipv6: false
  use-host: true
  enhanced-mode: fake-ip
  listen: 0.0.0.0:7874
  nameserver:
    - 8.8.8.8
    - 1.0.0.1
    - https://dns.google/dns-query
  fallback:
    - 1.1.1.1
    - 8.8.4.4
    - https://cloudflare-dns.com/dns-query
    - 112.215.203.254
  default-nameserver:
    - 8.8.8.8
    - 1.1.1.1
    - 112.215.203.254
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.localdomain"
    - "*.example"
    - "*.invalid"
    - "*.localhost"
    - "*.test"
    - "*.local"
    - "*.home.arpa"
    - time.*.com
    - time.*.gov
    - time.*.edu.cn
    - time.*.apple.com
    - time1.*.com
    - time2.*.com
    - time3.*.com
    - time4.*.com
    - time5.*.com
    - time6.*.com
    - time7.*.com
    - ntp.*.com
    - ntp1.*.com
    - ntp2.*.com
    - ntp3.*.com
    - ntp4.*.com
    - ntp5.*.com
    - ntp6.*.com
    - ntp7.*.com
    - "*.time.edu.cn"
    - "*.ntp.org.cn"
    - +.pool.ntp.org
    - time1.cloud.tencent.com
    - music.163.com
    - "*.music.163.com"
    - "*.126.net"
    - musicapi.taihe.com
    - music.taihe.com
    - songsearch.kugou.com
    - trackercdn.kugou.com
    - "*.kuwo.cn"
    - api-jooxtt.sanook.com
    - api.joox.com
    - joox.com
    - y.qq.com
    - "*.y.qq.com"
    - streamoc.music.tc.qq.com
    - mobileoc.music.tc.qq.com
    - isure.stream.qqmusic.qq.com
    - dl.stream.qqmusic.qq.com
    - aqqmusic.tc.qq.com
    - amobile.music.tc.qq.com
    - "*.xiami.com"
    - "*.music.migu.cn"
    - music.migu.cn
    - "*.msftconnecttest.com"
    - "*.msftncsi.com"
    - msftconnecttest.com
    - msftncsi.com
    - localhost.ptlogin2.qq.com
    - localhost.sec.qq.com
    - +.srv.nintendo.net
    - +.stun.playstation.net
    - xbox.*.microsoft.com
    - xnotify.xboxlive.com
    - +.battlenet.com.cn
    - +.wotgame.cn
    - +.wggames.cn
    - +.wowsgame.cn
    - +.wargaming.net
    - proxy.golang.org
    - stun.*.*
    - stun.*.*.*
    - +.stun.*.*
    - +.stun.*.*.*
    - +.stun.*.*.*.*
    - heartbeat.belkin.com
    - "*.linksys.com"
    - "*.linksyssmartwifi.com"
    - "*.router.asus.com"
    - mesu.apple.com
    - swscan.apple.com
    - swquery.apple.com
    - swdownload.apple.com
    - swcdn.apple.com
    - swdist.apple.com
    - lens.l.google.com
    - stun.l.google.com
    - +.nflxvideo.net
    - "*.square-enix.com"
    - "*.finalfantasyxiv.com"
    - "*.ffxiv.com"
    - "*.mcdn.bilivideo.cn"
    - +.media.dssott.com
proxies:${conf}
proxy-groups:
- name: INTERNET
  type: select
  disable-udp: true
  proxies:
  - BEST-PING
${bex}- name: ADS
  type: select
  disable-udp: false
  proxies:
  - REJECT
  - INTERNET
- name: BEST-PING
  type: url-test
  url: https://detectportal.firefox.com/success.txt
  interval: 60
  proxies:
${bex}rule-providers:
  rule_hijacking:
    type: file
    behavior: classical
    path: "./rule_provider/rule_hijacking.yaml"
    url: https://raw.githubusercontent.com/malikshi/open_clash/main/rule_provider/rule_hijacking.yaml
  rule_privacy:
    type: file
    behavior: classical
    url: https://raw.githubusercontent.com/malikshi/open_clash/main/rule_provider/rule_privacy.yaml
    path: "./rule_provider/rule_privacy.yaml"
  rule_basicads:
    type: file
    behavior: domain
    url: https://raw.githubusercontent.com/malikshi/open_clash/main/rule_provider/rule_basicads.yaml
    path: "./rule_provider/rule_basicads.yaml"
  rule_personalads:
    type: file
    behavior: classical
    url: https://raw.githubusercontent.com/malikshi/open_clash/main/rule_provider/rule_personalads.yaml
    path: "./rule_provider/rule_personalads.yaml"
rules:
- IP-CIDR,198.18.0.1/16,REJECT,no-resolve
- RULE-SET,rule_personalads,ADS
- RULE-SET,rule_basicads,ADS
- RULE-SET,rule_hijacking,ADS
- RULE-SET,rule_privacy,ADS
- MATCH,INTERNET`;
}
async function generateSurfboardSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    if (type === 'trojan') {
      bex += `${ispName},`
      conf += `
${ispName} = trojan, ${bug}, 443, password = ${UUIDS}, udp-relay = true, skip-cert-verify = true, sni = ${geo81}, ws = true, ws-path = /${proxyHost}:${proxyPort}, ws-headers = Host:"${geo81}"\n`;
    }
  }
  return `#### BY : GEO PROJECT #### 

[General]
dns-server = system, 108.137.44.39, 108.137.44.9, puredns.org:853

[Proxy]
${conf}

[Proxy Group]
Select Group = select,Load Balance,Best Ping,FallbackGroup,${bex}
Load Balance = load-balance,${bex}
Best Ping = url-test,${bex} url=http://www.gstatic.com/generate_204, interval=600, tolerance=100, timeout=5
FallbackGroup = fallback,${bex} url=http://www.gstatic.com/generate_204, interval=600, timeout=5
AdBlock = select,REJECT,Select Group

[Rule]
MATCH,Select Group
DOMAIN-SUFFIX,pagead2.googlesyndication.com, AdBlock
DOMAIN-SUFFIX,pagead2.googleadservices.com, AdBlock
DOMAIN-SUFFIX,afs.googlesyndication.com, AdBlock
DOMAIN-SUFFIX,ads.google.com, AdBlock
DOMAIN-SUFFIX,adservice.google.com, AdBlock
DOMAIN-SUFFIX,googleadservices.com, AdBlock
DOMAIN-SUFFIX,static.media.net, AdBlock
DOMAIN-SUFFIX,media.net, AdBlock
DOMAIN-SUFFIX,adservetx.media.net, AdBlock
DOMAIN-SUFFIX,mediavisor.doubleclick.net, AdBlock
DOMAIN-SUFFIX,m.doubleclick.net, AdBlock
DOMAIN-SUFFIX,static.doubleclick.net, AdBlock
DOMAIN-SUFFIX,doubleclick.net, AdBlock
DOMAIN-SUFFIX,ad.doubleclick.net, AdBlock
DOMAIN-SUFFIX,fastclick.com, AdBlock
DOMAIN-SUFFIX,fastclick.net, AdBlock
DOMAIN-SUFFIX,media.fastclick.net, AdBlock
DOMAIN-SUFFIX,cdn.fastclick.net, AdBlock
DOMAIN-SUFFIX,adtago.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,analyticsengine.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,advice-ads.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,affiliationjs.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,advertising-api-eu.amazon.com, AdBlock
DOMAIN-SUFFIX,amazonclix.com, AdBlock, AdBlock
DOMAIN-SUFFIX,assoc-amazon.com, AdBlock
DOMAIN-SUFFIX,ads.yahoo.com, AdBlock
DOMAIN-SUFFIX,adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,global.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,us.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,br.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,latam.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,ush.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,de.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,es.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,fr.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,in.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,it.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,sea.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,uk.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,cms.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,opus.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,sp.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,comet.yahoo.com, AdBlock
DOMAIN-SUFFIX,log.fc.yahoo.com, AdBlock
DOMAIN-SUFFIX,ganon.yahoo.com, AdBlock
DOMAIN-SUFFIX,gemini.yahoo.com, AdBlock
DOMAIN-SUFFIX,beap.gemini.yahoo.com, AdBlock
DOMAIN-SUFFIX,geo.yahoo.com, AdBlock
DOMAIN-SUFFIX,marketingsolutions.yahoo.com, AdBlock
DOMAIN-SUFFIX,pclick.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,geo.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,onepush.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,bats.video.yahoo.com, AdBlock
DOMAIN-SUFFIX,visit.webhosting.yahoo.com, AdBlock
DOMAIN-SUFFIX,ads.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,m.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,partnerads.ysm.yahoo.com, AdBlock
DOMAIN-SUFFIX,appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,19534.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,3.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,30488.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,4.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,report.appmetrica.yandex.net, AdBlock
DOMAIN-SUFFIX,extmaps-api.yandex.net, AdBlock
DOMAIN-SUFFIX,analytics.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners-slb.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,startup.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,offerwall.yandex.net, AdBlock
DOMAIN-SUFFIX,adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,matchid.adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,adsdk.yandex.ru, AdBlock
DOMAIN-SUFFIX,an.yandex.ru, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.ru, AdBlock
DOMAIN-SUFFIX,awaps.yandex.ru, AdBlock
DOMAIN-SUFFIX,awsync.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs-meta.yandex.ru, AdBlock
DOMAIN-SUFFIX,clck.yandex.ru, AdBlock
DOMAIN-SUFFIX,informer.yandex.ru, AdBlock
DOMAIN-SUFFIX,kiks.yandex.ru, AdBlock
DOMAIN-SUFFIX,grade.market.yandex.ru, AdBlock
DOMAIN-SUFFIX,mc.yandex.ru, AdBlock
DOMAIN-SUFFIX,metrika.yandex.ru, AdBlock
DOMAIN-SUFFIX,click.sender.yandex.ru, AdBlock
DOMAIN-SUFFIX,share.yandex.ru, AdBlock
DOMAIN-SUFFIX,yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,mobile.yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,google-analytics.com, AdBlock
DOMAIN-SUFFIX,ssl.google-analytics.com, AdBlock
DOMAIN-SUFFIX,api-hotjar.com, AdBlock
DOMAIN-SUFFIX,hotjar-analytics.com, AdBlock
DOMAIN-SUFFIX,hotjar.com, AdBlock
DOMAIN-SUFFIX,static.hotjar.com, AdBlock
DOMAIN-SUFFIX,mouseflow.com, AdBlock
DOMAIN-SUFFIX,a.mouseflow.com, AdBlock
DOMAIN-SUFFIX,freshmarketer.com, AdBlock
DOMAIN-SUFFIX,luckyorange.com, AdBlock
DOMAIN-SUFFIX,luckyorange.net, AdBlock
DOMAIN-SUFFIX,cdn.luckyorange.com, AdBlock
DOMAIN-SUFFIX,w1.luckyorange.com, AdBlock
DOMAIN-SUFFIX,upload.luckyorange.net, AdBlock
DOMAIN-SUFFIX,cs.luckyorange.net, AdBlock
DOMAIN-SUFFIX,settings.luckyorange.net, AdBlock
DOMAIN-SUFFIX,stats.wp.com, AdBlock
DOMAIN-SUFFIX,notify.bugsnag.com, AdBlock
DOMAIN-SUFFIX,sessions.bugsnag.com, AdBlock
DOMAIN-SUFFIX,api.bugsnag.com, AdBlock
DOMAIN-SUFFIX,app.bugsnag.com, AdBlock
DOMAIN-SUFFIX,browser.sentry-cdn.com, AdBlock
DOMAIN-SUFFIX,app.getsentry.com, AdBlock
DOMAIN-SUFFIX,pixel.facebook.com, AdBlock
DOMAIN-SUFFIX,analytics.facebook.com, AdBlock
DOMAIN-SUFFIX,ads.facebook.com, AdBlock
DOMAIN-SUFFIX,an.facebook.com, AdBlock
DOMAIN-SUFFIX,ads-api.twitter.com, AdBlock
DOMAIN-SUFFIX,advertising.twitter.com, AdBlock
DOMAIN-SUFFIX,ads-twitter.com, AdBlock
DOMAIN-SUFFIX,static.ads-twitter.com, AdBlock
DOMAIN-SUFFIX,ads.linkedin.com, AdBlock
DOMAIN-SUFFIX,analytics.pointdrive.linkedin.com, AdBlock
DOMAIN-SUFFIX,ads.pinterest.com, AdBlock
DOMAIN-SUFFIX,log.pinterest.com, AdBlock
DOMAIN-SUFFIX,ads-dev.pinterest.com, AdBlock
DOMAIN-SUFFIX,analytics.pinterest.com, AdBlock
DOMAIN-SUFFIX,trk.pinterest.com, AdBlock
DOMAIN-SUFFIX,trk2.pinterest.com, AdBlock
DOMAIN-SUFFIX,widgets.pinterest.com, AdBlock
DOMAIN-SUFFIX,ads.reddit.com, AdBlock
DOMAIN-SUFFIX,rereddit.com, AdBlock
DOMAIN-SUFFIX,events.redditmedia.com, AdBlock
DOMAIN-SUFFIX,d.reddit.com, AdBlock
DOMAIN-SUFFIX,ads-sg.tiktok.com, AdBlock
DOMAIN-SUFFIX,analytics-sg.tiktok.com, AdBlock
DOMAIN-SUFFIX,ads.tiktok.com, AdBlock
DOMAIN-SUFFIX,analytics.tiktok.com, AdBlock
DOMAIN-SUFFIX,ads.youtube.com, AdBlock
DOMAIN-SUFFIX,youtube.cleverads.vn, AdBlock
DOMAIN-SUFFIX,ads.yahoo.com, AdBlock
DOMAIN-SUFFIX,adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,global.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,us.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,ads.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,m.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,partnerads.ysm.yahoo.com, AdBlock
DOMAIN-SUFFIX,appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,19534.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,3.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,30488.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,4.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,report.appmetrica.yandex.net, AdBlock
DOMAIN-SUFFIX,extmaps-api.yandex.net, AdBlock
DOMAIN-SUFFIX,analytics.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners-slb.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,startup.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,offerwall.yandex.net, AdBlock
DOMAIN-SUFFIX,adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,matchid.adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,adsdk.yandex.ru, AdBlock
DOMAIN-SUFFIX,an.yandex.ru, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.ru, AdBlock
DOMAIN-SUFFIX,awaps.yandex.ru, AdBlock
DOMAIN-SUFFIX,awsync.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs-meta.yandex.ru, AdBlock
DOMAIN-SUFFIX,clck.yandex.ru, AdBlock
DOMAIN-SUFFIX,informer.yandex.ru, AdBlock
DOMAIN-SUFFIX,kiks.yandex.ru, AdBlock
DOMAIN-SUFFIX,grade.market.yandex.ru, AdBlock
DOMAIN-SUFFIX,mc.yandex.ru, AdBlock
DOMAIN-SUFFIX,metrika.yandex.ru, AdBlock
DOMAIN-SUFFIX,click.sender.yandex.ru, AdBlock
DOMAIN-SUFFIX,share.yandex.ru, AdBlock
DOMAIN-SUFFIX,yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,mobile.yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,bdapi-in-ads.realmemobile.com, AdBlock
DOMAIN-SUFFIX,adsfs.oppomobile.com, AdBlock
DOMAIN-SUFFIX,adx.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,bdapi.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,ck.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,data.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,g1.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,api.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,app.chat.xiaomi.net, AdBlock
DOMAIN-SUFFIX,data.mistat.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.intl.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.india.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.rus.xiaomi.com, AdBlock
DOMAIN-SUFFIX,sdkconfig.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,sdkconfig.ad.intl.xiaomi.com, AdBlock
DOMAIN-SUFFIX,globalapi.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,www.cdn.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,tracking.miui.com, AdBlock
DOMAIN-SUFFIX,sa.api.intl.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.intl.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.india.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.rus.miui.com, AdBlock
DOMAIN-SUFFIX,analytics.oneplus.cn, AdBlock
DOMAIN-SUFFIX,click.oneplus.cn, AdBlock
DOMAIN-SUFFIX,click.oneplus.com, AdBlock
DOMAIN-SUFFIX,open.oneplus.net, AdBlock
DOMAIN-SUFFIX,metrics.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics1.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics2.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics3.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics4.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics5.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,logservice.hicloud.com, AdBlock
DOMAIN-SUFFIX,logservice1.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics-dra.dt.hicloud.com, AdBlock
DOMAIN-SUFFIX,logbak.hicloud.com, AdBlock
DOMAIN-SUFFIX,ad.samsungadhub.com, AdBlock
DOMAIN-SUFFIX,samsungadhub.com, AdBlock
DOMAIN-SUFFIX,samsungads.com, AdBlock
DOMAIN-SUFFIX,smetrics.samsung.com, AdBlock
DOMAIN-SUFFIX,nmetrics.samsung.com, AdBlock
DOMAIN-SUFFIX,samsung-com.112.2o7.net, AdBlock
DOMAIN-SUFFIX,business.samsungusa.com, AdBlock
DOMAIN-SUFFIX,analytics.samsungknox.com, AdBlock
DOMAIN-SUFFIX,bigdata.ssp.samsung.com, AdBlock
DOMAIN-SUFFIX,analytics-api.samsunghealthcn.com, AdBlock
DOMAIN-SUFFIX,config.samsungads.com, AdBlock
DOMAIN-SUFFIX,metrics.apple.com, AdBlock
DOMAIN-SUFFIX,securemetrics.apple.com, AdBlock
DOMAIN-SUFFIX,supportmetrics.apple.com, AdBlock
DOMAIN-SUFFIX,metrics.icloud.com, AdBlock
DOMAIN-SUFFIX,metrics.mzstatic.com, AdBlock
DOMAIN-SUFFIX,dzc-metrics.mzstatic.com, AdBlock
DOMAIN-SUFFIX,books-analytics-events.news.apple-dns.net, AdBlock
DOMAIN-SUFFIX,books-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,stocks-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,stocks-analytics-events.news.apple-dns.net, AdBlock
DOMAIN-KEYWORD,pagead2, AdBlock
DOMAIN-KEYWORD,adservice, AdBlock
DOMAIN-KEYWORD,.ads, AdBlock
DOMAIN-KEYWORD,.ad, AdBlock
DOMAIN-KEYWORD,adservetx, AdBlock
DOMAIN-KEYWORD,mediavisor, AdBlock
DOMAIN-KEYWORD,adtago, AdBlock
DOMAIN-KEYWORD,analyticsengine, AdBlock
DOMAIN-KEYWORD,advice-ads, AdBlock
DOMAIN-KEYWORD,affiliationjs, AdBlock
DOMAIN-KEYWORD,advertising, AdBlock
DOMAIN-KEYWORD,adserver, AdBlock
DOMAIN-KEYWORD,pclick, AdBlock
DOMAIN-KEYWORD,partnerads, AdBlock
DOMAIN-KEYWORD,appmetrica, AdBlock
DOMAIN-KEYWORD,adfox, AdBlock
DOMAIN-KEYWORD,adsdk, AdBlock
DOMAIN-KEYWORD,clck, AdBlock
DOMAIN-KEYWORD,metrika, AdBlock
DOMAIN-KEYWORD,api-hotjar, AdBlock
DOMAIN-KEYWORD,hotjar-analytics, AdBlock
DOMAIN-KEYWORD,hotjar, AdBlock
DOMAIN-KEYWORD,luckyorange, AdBlock
DOMAIN-KEYWORD,bugsnag, AdBlock
DOMAIN-KEYWORD,sentry-cdn, AdBlock
DOMAIN-KEYWORD,getsentry, AdBlock
DOMAIN-KEYWORD,ads-api, AdBlock
DOMAIN-KEYWORD,ads-twitter, AdBlock
DOMAIN-KEYWORD,pointdrive, AdBlock
DOMAIN-KEYWORD,ads-dev, AdBlock
DOMAIN-KEYWORD,trk, AdBlock
DOMAIN-KEYWORD,cleverads, AdBlock
DOMAIN-KEYWORD,ads-sg, AdBlock
DOMAIN-KEYWORD,analytics-sg, AdBlock
DOMAIN-KEYWORD,adspecs, AdBlock
DOMAIN-KEYWORD,adsfs, AdBlock
DOMAIN-KEYWORD,adx, AdBlock
DOMAIN-KEYWORD,tracking, AdBlock
DOMAIN-KEYWORD,logservice, AdBlock
DOMAIN-KEYWORD,logbak, AdBlock
DOMAIN-KEYWORD,smetrics, AdBlock
DOMAIN-KEYWORD,nmetrics, AdBlock
DOMAIN-KEYWORD,securemetrics, AdBlock
DOMAIN-KEYWORD,supportmetrics, AdBlock
DOMAIN-KEYWORD,books-analytics, AdBlock
DOMAIN-KEYWORD,stocks-analytics, AdBlock
DOMAIN-SUFFIX,analytics.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,analytics.google.com, AdBlock
DOMAIN-SUFFIX,click.googleanalytics.com, AdBlock
DOMAIN-SUFFIX,events.reddit.com, AdBlock
DOMAIN-SUFFIX,business-api.tiktok.com, AdBlock
DOMAIN-SUFFIX,log.byteoversea.com, AdBlock
DOMAIN-SUFFIX,udc.yahoo.com, AdBlock
DOMAIN-SUFFIX,udcm.yahoo.com, AdBlock
DOMAIN-SUFFIX,auction.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,webview.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,config.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,adfstat.yandex.ru, AdBlock
DOMAIN-SUFFIX,iot-eu-logser.realme.com, AdBlock
DOMAIN-SUFFIX,iot-logser.realme.com, AdBlock
DOMAIN-SUFFIX,bdapi-ads.realmemobile.com, AdBlock
DOMAIN-SUFFIX,grs.hicloud.com, AdBlock
DOMAIN-SUFFIX,weather-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,notes-analytics-events.apple.com, AdBlock
FINAL,Select Group`;
}
async function generateHusiSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "disable_sni": false,\n        "enabled": true,\n        "insecure": true,\n        "server_name": "${geo81}"\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },`;
    } else if (type === 'ss') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} vless",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} trojan",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    }
  }
  return `#### BY : GEO PROJECT #### 

{
  "dns": {
    "final": "dns-final",
    "independent_cache": true,
    "rules": [
      {
        "disable_cache": false,
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "servers": [
      {
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only",
        "tag": "remote-dns"
      },
      {
        "address": "local",
        "strategy": "ipv4_only",
        "tag": "direct-dns"
      },
      {
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only",
        "tag": "dns-final"
      },
      {
        "address": "local",
        "tag": "dns-local"
      },
      {
        "address": "rcode://success",
        "tag": "dns-block"
      }
    ]
  },
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "../cache/cache.db",
      "store_fakeip": true
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090"
    },
    "v2ray_api": {
      "listen": "127.0.0.1:0",
      "stats": {
        "enabled": true,
        "outbounds": [
          "proxy",
          "direct"
        ]
      }
    }
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "listen_port": 6450,
      "override_address": "8.8.8.8",
      "override_port": 53,
      "tag": "dns-in",
      "type": "direct"
    },
    {
      "domain_strategy": "",
      "endpoint_independent_nat": true,
      "inet4_address": [
        "172.19.0.1/28"
      ],
      "mtu": 9000,
      "sniff": true,
      "sniff_override_destination": true,
      "stack": "system",
      "tag": "tun-in",
      "type": "tun"
    },
    {
      "domain_strategy": "",
      "listen": "0.0.0.0",
      "listen_port": 2080,
      "sniff": true,
      "sniff_override_destination": true,
      "tag": "mixed-in",
      "type": "mixed"
    }
  ],
  "log": {
    "level": "info"
  },
  "outbounds": [
    {
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ],
      "tag": "Internet",
      "type": "selector"
    },
    {
      "interval": "1m0s",
      "outbounds": [
${bex}        "direct"
      ],
      "tag": "Best Latency",
      "type": "urltest",
      "url": "https://detectportal.firefox.com/success.txt"
    },
${conf}
    {
      "tag": "direct",
      "type": "direct"
    },
    {
      "tag": "bypass",
      "type": "direct"
    },
    {
      "tag": "block",
      "type": "block"
    },
    {
      "tag": "dns-out",
      "type": "dns"
    }
  ],
  "route": {
    "auto_detect_interface": true,
    "rules": [
      {
        "outbound": "dns-out",
        "port": [
          53
        ]
      },
      {
        "inbound": [
          "dns-in"
        ],
        "outbound": "dns-out"
      },
      {
        "network": [
          "udp"
        ],
        "outbound": "block",
        "port": [
          443
        ],
        "port_range": []
      },
      {
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block",
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ]
      }
    ]
  }
}`;
}
async function generateSingboxSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "enabled": true,\n        "server_name": "${geo81}",\n        "insecure": true\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "vless",
      "tag": "${ispName}",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "uuid": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${geo81}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      },
      "packet_encoding": "xudp"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "trojan",
      "tag": "${ispName}",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "password": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${geo81}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },`;
    } else if (type === 'ss') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "type": "vless",
      "tag": "${ispName} vless",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "uuid": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${geo81}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      },
      "packet_encoding": "xudp"
    },
    {
      "type": "trojan",
      "tag": "${ispName} trojan",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "password": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${geo81}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    }
  }
  return `#### BY : GEO PROJECT #### 

{
  "log": {
    "level": "info"
  },
  "dns": {
    "servers": [
      {
        "tag": "remote-dns",
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only"
      },
      {
        "tag": "direct-dns",
        "address": "local",
        "strategy": "ipv4_only"
      },
      {
        "tag": "dns-final",
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only"
      },
      {
        "tag": "dns-local",
        "address": "local"
      },
      {
        "tag": "dns-block",
        "address": "rcode://success"
      }
    ],
    "rules": [
      {
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "final": "dns-final",
    "independent_cache": true
  },
  "inbounds": [
    {
      "type": "tun",
      "mtu": 1400,
      "inet4_address": "172.19.0.1/30",
      "inet6_address": "fdfe:dcba:9876::1/126",
      "auto_route": true,
      "strict_route": true,
      "endpoint_independent_nat": true,
      "stack": "mixed",
      "sniff": true
    }
  ],
  "outbounds": [
    {
      "tag": "Internet",
      "type": "selector",
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ]
    },
    {
      "type": "urltest",
      "tag": "Best Latency",
      "outbounds": [
${bex}        "direct"
      ],
      "url": "https://ping.geo81.us.kg",
      "interval": "30s"
    },
${conf}
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "direct",
      "tag": "bypass"
    },
    {
      "type": "block",
      "tag": "block"
    },
    {
      "type": "dns",
      "tag": "dns-out"
    }
  ],
  "route": {
    "rules": [
      {
        "port": 53,
        "outbound": "dns-out"
      },
      {
        "inbound": "dns-in",
        "outbound": "dns-out"
      },
      {
        "network": "udp",
        "port": 443,
        "outbound": "block"
      },
      {
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block"
      }
    ],
    "auto_detect_interface": true
  },
  "experimental": {
    "cache_file": {
      "enabled": false
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "external_ui": "ui",
      "external_ui_download_url": "https://github.com/MetaCubeX/metacubexd/archive/gh-pages.zip",
      "external_ui_download_detour": "Internet",
      "secret": "bitzblack",
      "default_mode": "rule"
    }
  }
}`;
}
async function generateNekoboxSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "disable_sni": false,\n        "enabled": true,\n        "insecure": true,\n        "server_name": "${geo81}"\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },`;
    } else if (type === 'ss') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} vless",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} trojan",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${geo81}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${geo81};tls=1"
    },`;
    }
  }
  return `#### BY : GEO PROJECT #### 

{
  "dns": {
    "final": "dns-final",
    "independent_cache": true,
    "rules": [
      {
        "disable_cache": false,
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "servers": [
      {
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only",
        "tag": "remote-dns"
      },
      {
        "address": "local",
        "strategy": "ipv4_only",
        "tag": "direct-dns"
      },
      {
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only",
        "tag": "dns-final"
      },
      {
        "address": "local",
        "tag": "dns-local"
      },
      {
        "address": "rcode://success",
        "tag": "dns-block"
      }
    ]
  },
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "../cache/clash.db",
      "store_fakeip": true
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "external_ui": "../files/yacd"
    }
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "listen_port": 6450,
      "override_address": "8.8.8.8",
      "override_port": 53,
      "tag": "dns-in",
      "type": "direct"
    },
    {
      "domain_strategy": "",
      "endpoint_independent_nat": true,
      "inet4_address": [
        "172.19.0.1/28"
      ],
      "mtu": 9000,
      "sniff": true,
      "sniff_override_destination": true,
      "stack": "system",
      "tag": "tun-in",
      "type": "tun"
    },
    {
      "domain_strategy": "",
      "listen": "0.0.0.0",
      "listen_port": 2080,
      "sniff": true,
      "sniff_override_destination": true,
      "tag": "mixed-in",
      "type": "mixed"
    }
  ],
  "log": {
    "level": "info"
  },
  "outbounds": [
    {
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ],
      "tag": "Internet",
      "type": "selector"
    },
    {
      "interval": "1m0s",
      "outbounds": [
${bex}        "direct"
      ],
      "tag": "Best Latency",
      "type": "urltest",
      "url": "https://detectportal.firefox.com/success.txt"
    },
${conf}
    {
      "tag": "direct",
      "type": "direct"
    },
    {
      "tag": "bypass",
      "type": "direct"
    },
    {
      "tag": "block",
      "type": "block"
    },
    {
      "tag": "dns-out",
      "type": "dns"
    }
  ],
  "route": {
    "auto_detect_interface": true,
    "rules": [
      {
        "outbound": "dns-out",
        "port": [
          53
        ]
      },
      {
        "inbound": [
          "dns-in"
        ],
        "outbound": "dns-out"
      },
      {
        "network": [
          "udp"
        ],
        "outbound": "block",
        "port": [
          443
        ],
        "port_range": []
      },
      {
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block",
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ]
      }
    ]
  }
}`;
}
async function generateV2rayngSub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean);

  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }

  let conf = '';

  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const countryCode = parts[2]; // Kode negara ISO
    const isp = parts[3]; // Informasi ISP

    // Gunakan teks Latin-1 untuk menggantikan emoji flag
    const countryText = `[${countryCode}]`; // Format bendera ke teks Latin-1
    const ispInfo = `${countryText} ${isp}`;
    const UUIDS = `${generateUUIDv4()}`;

    if (type === 'vless') {
      if (tls) {
        conf += `vless://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
      } else {
        conf += `vless://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${ispInfo}\n`;
      }
    } else if (type === 'trojan') {
      if (tls) {
        conf += `trojan://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
      } else {
        conf += `trojan://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${ispInfo}\n`;
      }
    } else if (type === 'ss') {
      if (tls) {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${geo81}#${ispInfo}\n`;
      } else {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${geo81}#${ispInfo}\n`;
      }
    } else if (type === 'mix') {
      if (tls) {
        conf += `vless://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
        conf += `trojan://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${geo81}#${ispInfo}\n`;
      } else {
        conf += `vless://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${ispInfo}\n`;
        conf += `trojan://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${ispInfo}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${geo81}#${ispInfo}\n`;
      }
    }
  }

  const base64Conf = btoa(conf.replace(/ /g, '%20'));

  return base64Conf;
}
async function generateV2raySub(type, bug, geo81, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(proxyListURL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const UUIDS = generateUUIDv4();
    const information = encodeURIComponent(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]}`);
    if (type === 'vless') {
      if (tls) {
        conf += `vless://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
      } else {
        conf += `vless://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${information}\n`;
      }
    } else if (type === 'trojan') {
      if (tls) {
        conf += `trojan://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
      } else {
        conf += `trojan://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${information}\n`;
      }
    } else if (type === 'ss') {
      if (tls) {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${geo81}#${information}\n`;
      } else {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${geo81}#${information}\n`;
      }
    } else if (type === 'mix') {
      if (tls) {
        conf += `vless://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
        conf += `trojan://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${geo81}&fp=randomized&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${geo81}#${information}\n`;
      } else {
        conf += `vless://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${information}\n`;
        conf += `trojan://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${geo81}&fp=randomized&type=ws&sni=${geo81}#${information}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${geo81}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${geo81}#${information}\n`;
      }
    }
  }
  
  return conf;
}
function generateUUIDv4() {
  const randomValues = crypto.getRandomValues(new Uint8Array(16));
  randomValues[6] = (randomValues[6] & 0x0f) | 0x40;
  randomValues[8] = (randomValues[8] & 0x3f) | 0x80;
  return [
    randomValues[0].toString(16).padStart(2, '0'),
    randomValues[1].toString(16).padStart(2, '0'),
    randomValues[2].toString(16).padStart(2, '0'),
    randomValues[3].toString(16).padStart(2, '0'),
    randomValues[4].toString(16).padStart(2, '0'),
    randomValues[5].toString(16).padStart(2, '0'),
    randomValues[6].toString(16).padStart(2, '0'),
    randomValues[7].toString(16).padStart(2, '0'),
    randomValues[8].toString(16).padStart(2, '0'),
    randomValues[9].toString(16).padStart(2, '0'),
    randomValues[10].toString(16).padStart(2, '0'),
    randomValues[11].toString(16).padStart(2, '0'),
    randomValues[12].toString(16).padStart(2, '0'),
    randomValues[13].toString(16).padStart(2, '0'),
    randomValues[14].toString(16).padStart(2, '0'),
    randomValues[15].toString(16).padStart(2, '0'),
  ].join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
