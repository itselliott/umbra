/* ============================================================
   Umbra — shared risk-scoring engine  (@umbra/core)

   The single source of truth for extension risk scoring. Consumed by:
     - the free single-user extension (loaded as a global `Audit`)
     - the managed collector extension
     - the backend, which `require()`s it and scores server-side

   Environment-agnostic: attaches `Audit` to `self` in a browser /
   service worker, and to `module.exports` under Node. No network
   calls — every score is computed from data Chrome's
   `chrome.management` API already exposes.
   ============================================================ */
(function (global) {
  "use strict";

  /* ---- API-permission risk weights -------------------------------------
     Higher = more dangerous if abused. Tuned so that one broad capability
     alone lands an extension in "high", and broad host access + a couple
     of sensitive APIs lands it in "critical". */
  var PERM_WEIGHTS = {
    debugger: 38,                              // total control of any page
    desktopCapture: 22,
    nativeMessaging: 22,                       // escapes the browser sandbox
    proxy: 20,
    pageCapture: 18,
    clipboardRead: 18,
    privacy: 16,
    cookies: 16,                               // session/login theft
    history: 16,
    tabCapture: 16,
    management: 15,                            // can disable/remove other extensions
    webRequest: 15,
    declarativeNetRequestWithHostAccess: 12,
    scripting: 12,
    contentSettings: 10,
    declarativeNetRequest: 10,
    geolocation: 10,
    downloads: 9,
    tabs: 9,
    bookmarks: 8,
    webRequestBlocking: 6,
    clipboardWrite: 3,
    activeTab: 2,
    storage: 1,
    notifications: 1,
    contextMenus: 1,
    alarms: 0,
    idle: 0
  };

  var PERM_LABEL = {
    debugger: "Debug and fully control any page — the most powerful permission Chrome grants",
    desktopCapture: "Capture the contents of your screen",
    nativeMessaging: "Communicate with desktop apps outside the browser sandbox",
    proxy: "Route all of your network traffic through a proxy",
    pageCapture: "Save the complete content of any page you visit",
    clipboardRead: "Read whatever you copy to your clipboard",
    privacy: "Change your browser's privacy and security settings",
    cookies: "Read cookies and your active login sessions",
    history: "Read your full browsing history",
    tabCapture: "Capture the audio and video of your tabs",
    management: "View, disable, and uninstall your other extensions",
    webRequest: "Observe and analyze every network request you make",
    declarativeNetRequestWithHostAccess: "Block, redirect, or modify network requests",
    scripting: "Inject its own scripts into web pages",
    contentSettings: "Change site permission settings (camera, location, etc.)",
    declarativeNetRequest: "Block or redirect network requests",
    geolocation: "Detect your physical location",
    downloads: "Open, manage, and trigger file downloads",
    tabs: "See the URL, title, and favicon of every tab you have open",
    bookmarks: "Read and change your bookmarks",
    webRequestBlocking: "Block network requests synchronously",
    clipboardWrite: "Write data to your clipboard",
    activeTab: "Access the current tab, but only when you click the extension",
    storage: "Store data locally on your device",
    notifications: "Show you desktop notifications",
    contextMenus: "Add items to your right-click menu",
    alarms: "Schedule background tasks",
    idle: "Detect when your device is idle"
  };

  /* Host-permission patterns that mean "every site you visit". */
  var BROAD_HOSTS = [
    "<all_urls>", "*://*/*", "http://*/*", "https://*/*",
    "http://*/", "https://*/", "*://*/", "file:///*", "<all_urls>/"
  ];

  /* Domains that, if an extension holds host access to them, mean it can
     read everything typed into an AI tool. */
  var AI_DOMAINS = [
    "chatgpt.com", "chat.openai.com", "openai.com", "claude.ai", "anthropic.com",
    "gemini.google.com", "bard.google.com", "perplexity.ai", "deepseek.com",
    "copilot.microsoft.com", "x.ai", "grok.com", "poe.com", "character.ai",
    "mistral.ai", "huggingface.co", "you.com", "phind.com"
  ];

  /* Bait / impersonation keywords commonly used by malicious AI extensions. */
  var BAIT = /\b(gpt-?5|gpt-?4o?|chat\s?gpt|claude\s?(sonnet|opus|ai)?|deepseek|ai sidebar|sidebar with|free vpn|unlimited proxy|crack|nitro generator)\b/i;
  var AI_NAME = /\bai\b|gpt|chatgpt|\bclaude\b|gemini|copilot|\bllm\b/i;

  /* Curated reputation lists. In the production product these sync from the
     cloud threat-intelligence service; in this local tool they are a small
     seed set. KNOWN_BAD entries are forced to score 100. */
  var KNOWN_GOOD = {
    "cjpalhdlnbpafiamejdnhcphjbkeiagm": "uBlock Origin — well-audited open-source content blocker"
  };
  var KNOWN_BAD = {
    // e.g. "abcdefghijklmnopabcdefghijklmnop": "Confirmed credential-exfiltration signature"
  };

  function analyzeHosts(hostPerms) {
    hostPerms = hostPerms || [];
    var broad = false, aiHit = [];
    for (var i = 0; i < hostPerms.length; i++) {
      var h = hostPerms[i];
      if (BROAD_HOSTS.indexOf(h) !== -1) broad = true;
      for (var j = 0; j < AI_DOMAINS.length; j++) {
        if (h.indexOf(AI_DOMAINS[j]) !== -1) aiHit.push(AI_DOMAINS[j]);
      }
    }
    return {
      broad: broad,
      aiDomains: aiHit.filter(function (v, k, a) { return a.indexOf(v) === k; }),
      count: hostPerms.length
    };
  }

  function tier(s) {
    return s >= 80 ? "critical" : s >= 55 ? "high" : s >= 30 ? "medium" : "low";
  }

  function pickIcon(icons) {
    if (!icons || !icons.length) return null;
    var best = icons[0];
    for (var i = 0; i < icons.length; i++) {
      if (icons[i].size >= 24 && icons[i].size <= 64) best = icons[i];
    }
    return best.url || icons[icons.length - 1].url || null;
  }

  /* Core scorer. Input is a chrome.management ExtensionInfo object. */
  function score(ext) {
    var perms = ext.permissions || [];
    var hostInfo = analyzeHosts(ext.hostPermissions);
    var reasons = [];
    var s = 0;

    // hard override: confirmed-bad signature
    if (KNOWN_BAD[ext.id]) {
      reasons.push({ sev: "critical", text: KNOWN_BAD[ext.id] });
      return finalize(ext, 100, reasons, hostInfo, true, true, false);
    }

    // host permissions
    if (hostInfo.broad) {
      s += 45;
      reasons.push({ sev: "critical", text: "Can read and change your data on every website you visit" });
    } else if (hostInfo.count > 8) {
      s += 28;
      reasons.push({ sev: "high", text: "Has access to " + hostInfo.count + " site patterns" });
    } else if (hostInfo.count > 0) {
      s += Math.min(hostInfo.count * 4, 18);
      reasons.push({ sev: "medium", text: "Has access to " + hostInfo.count + " specific site" + (hostInfo.count > 1 ? "s" : "") });
    }

    // API permissions
    for (var i = 0; i < perms.length; i++) {
      var p = perms[i];
      var w = PERM_WEIGHTS[p];
      if (w == null || w === 0) continue;
      s += w;
      var label = PERM_LABEL[p] || ("Uses the \"" + p + "\" capability");
      if (w >= 15) reasons.push({ sev: w >= 30 ? "critical" : "high", text: label });
      else if (w >= 8) reasons.push({ sev: "medium", text: label });
    }

    // AI interposition
    var aiInterposing = hostInfo.aiDomains.length > 0 || (AI_NAME.test(ext.name || "") && hostInfo.broad);
    if (hostInfo.aiDomains.length > 0) {
      s += 14;
      reasons.push({ sev: "high", text: "Injects itself into AI tools: " + hostInfo.aiDomains.join(", ") });
    } else if (aiInterposing) {
      s += 8;
      reasons.push({ sev: "high", text: "Presents as an AI tool and can read every page, including AI chats" });
    }

    // install source
    if (ext.installType === "sideload" || ext.installType === "other") {
      s += 22;
      reasons.push({ sev: "high", text: "Sideloaded — not installed from the Chrome Web Store, so it bypassed review" });
    } else if (ext.installType === "development") {
      s += 16;
      reasons.push({ sev: "high", text: "Loaded in developer mode — unsigned, unreviewed code" });
    }

    // bait / impersonation naming
    if (BAIT.test(ext.name || "") && ext.installType !== "admin") {
      s += 22;
      reasons.push({ sev: "high", text: "Name mimics a well-known product or uses high-risk bait keywords" });
    }

    // can't be turned off (and not managed by an admin) — possible persistence
    if (ext.mayDisable === false && ext.installType !== "admin") {
      s += 15;
      reasons.push({ sev: "high", text: "Cannot be disabled normally — a known malware-persistence trait" });
    }

    // known-good dampener
    var trusted = false;
    if (KNOWN_GOOD[ext.id]) {
      trusted = true;
      s = Math.round(s * 0.45);
      reasons.unshift({ sev: "low", text: "On Umbra's verified-publisher list: " + KNOWN_GOOD[ext.id] });
    }

    s = Math.max(0, Math.min(100, Math.round(s)));
    return finalize(ext, s, reasons, hostInfo, false, false, trusted, aiInterposing);
  }

  function finalize(ext, s, reasons, hostInfo, knownBad, forcedAi, trusted, aiInterposing) {
    return {
      id: ext.id,
      name: ext.name,
      shortName: ext.shortName || ext.name,
      version: ext.version,
      description: ext.description || "",
      enabled: ext.enabled,
      mayDisable: ext.mayDisable,
      installType: ext.installType,
      type: ext.type,
      homepageUrl: ext.homepageUrl || "",
      icon: pickIcon(ext.icons),
      permissions: ext.permissions || [],
      hostPermissions: ext.hostPermissions || [],
      score: s,
      tier: tier(s),
      reasons: reasons,
      hostInfo: hostInfo,
      aiInterposing: knownBad ? true : (forcedAi || !!aiInterposing),
      knownBad: !!knownBad,
      trusted: !!trusted
    };
  }

  /* Plain-English, one-paragraph summary of what an extension can do. */
  function plainEnglish(a) {
    if (a.knownBad) {
      return "This extension matches a confirmed malicious signature. Treat anything you typed or pasted in the browser while it was installed — passwords, keys, client data — as compromised.";
    }
    var can = [];
    if (a.hostInfo.broad) can.push("see and change the content of <b>every website you visit</b>");
    else if (a.hostInfo.count > 0) can.push("access " + a.hostInfo.count + " specific site" + (a.hostInfo.count > 1 ? "s" : ""));
    if (a.permissions.indexOf("cookies") !== -1) can.push("read your login sessions");
    if (a.permissions.indexOf("history") !== -1) can.push("read your full browsing history");
    if (a.permissions.indexOf("clipboardRead") !== -1) can.push("read whatever you copy");
    if (a.permissions.indexOf("nativeMessaging") !== -1) can.push("talk to programs outside the browser");
    if (a.permissions.indexOf("debugger") !== -1) can.push("take complete control of any page");
    if (a.aiInterposing) can.push("sit inside AI chat tools and read everything you type into them");
    if (!can.length) return a.name + " requests only minimal, low-risk permissions.";
    return a.name + " can " + joinList(can) + ".";
  }

  function joinList(arr) {
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + " and " + arr[1];
    return arr.slice(0, -1).join(", ") + ", and " + arr[arr.length - 1];
  }

  /* Why Umbra flagged it — the heuristics, in human terms. */
  function whyFlagged(a) {
    if (a.knownBad) return "Matched against a known credential-exfiltration signature.";
    var bits = [];
    if (a.installType === "sideload" || a.installType === "other")
      bits.push("It was sideloaded rather than installed from the Chrome Web Store, so it never went through Google's review.");
    if (a.installType === "development")
      bits.push("It is running as unpacked developer code — unsigned and unreviewed.");
    if (a.mayDisable === false && a.installType !== "admin")
      bits.push("It cannot be disabled through the normal Chrome controls, which is a common persistence trick.");
    if (a.aiInterposing)
      bits.push("It positions itself inside AI tools, which is exactly where sensitive prompts, code, and credentials get typed.");
    if (a.hostInfo.broad && a.tier !== "low")
      bits.push("Its all-sites access is broad enough that a malicious update — or a change of ownership — could weaponize it instantly.");
    if (a.trusted)
      bits.push("This is a recognized publisher, so the score is dampened — review it, don't necessarily remove it.");
    if (!bits.length)
      bits.push("Its requested permissions are modest and consistent with an ordinary, low-risk extension.");
    return bits.join(" ");
  }

  /* Ordered, concrete remediation steps. */
  function remediation(a) {
    if (a.tier === "low") return ["No action needed.", "Keep it updated and re-scan periodically."];
    if (a.trusted) {
      return [
        "Recognized publisher — review rather than remove.",
        "Confirm every install is on the latest version.",
        "Add it to your allowlist to silence this alert."
      ];
    }
    if (a.knownBad || a.tier === "critical") {
      return [
        "Disable it now with the button below, then uninstall it.",
        "Rotate any passwords or API keys you have entered in this browser recently.",
        "If this is a work device, tell your IT team or MSP immediately."
      ];
    }
    return [
      "Disable it and check whether anyone actually relies on it.",
      "Look for a lower-permission alternative that does the same job.",
      "If it is genuinely needed and trusted, add it to your allowlist."
    ];
  }

  /* Audit a full list of ExtensionInfo objects. */
  function auditAll(exts, selfId, allowlist) {
    allowlist = allowlist || [];
    return exts
      .filter(function (e) { return e.type === "extension" && e.id !== selfId; })
      .map(function (e) {
        var a = score(e);
        a.allowlisted = allowlist.indexOf(e.id) !== -1;
        return a;
      })
      .sort(function (a, b) {
        if (a.allowlisted !== b.allowlisted) return a.allowlisted ? 1 : -1;
        return b.score - a.score;
      });
  }

  /* Fleet-level summary + letter grade. */
  function summarize(results) {
    var counted = results.filter(function (r) { return !r.allowlisted; });
    var crit = counted.filter(function (r) { return r.tier === "critical"; }).length;
    var high = counted.filter(function (r) { return r.tier === "high"; }).length;
    var med = counted.filter(function (r) { return r.tier === "medium"; }).length;
    var grade = "A";
    if (crit > 0) grade = "F";
    else if (high >= 2) grade = "D";
    else if (high === 1) grade = "C";
    else if (med >= 3) grade = "B";
    return {
      total: results.length,
      enabled: results.filter(function (r) { return r.enabled; }).length,
      critical: crit,
      high: high,
      medium: med,
      ai: counted.filter(function (r) { return r.aiInterposing; }).length,
      broad: counted.filter(function (r) { return r.hostInfo.broad; }).length,
      allowlisted: results.length - counted.length,
      grade: grade
    };
  }

  global.Audit = {
    score: score,
    auditAll: auditAll,
    summarize: summarize,
    plainEnglish: plainEnglish,
    whyFlagged: whyFlagged,
    remediation: remediation,
    tier: tier,
    PERM_LABEL: PERM_LABEL,
    AI_DOMAINS: AI_DOMAINS
  };
})(typeof self !== "undefined" ? self : this);
