const YandexApiOnRequestHandlers = [];
const YandexApiOnResponseHandlers = [];
const originalFetch = window.fetch.bind(window);
let interceptorInitialized = false;

// Analytics endpoints are intentionally disabled by the mod.
navigator.sendBeacon = function () {
  return true;
};

(function blockAnalyticsScripts() {
  const originalAppendChild = document.head.appendChild;

  document.head.appendChild = function (element) {
    if (element instanceof HTMLScriptElement) {
      const src = element.src || "";
      if (src.includes("https://yandex.ru/ads/system/adsdk.js") || src.includes("https://mc.yandex.ru/metrika/tag.js")) {
        console.log("Blocked Yandex analytics script:", src);
        return element;
      }
    }

    return originalAppendChild.call(this, element);
  };
})();

function resolveRequestUrl(input) {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return new URL(input, window.location.href).href;
  return "";
}

function isBlockedAnalyticsUrl(url) {
  return url.includes("log.strm.yandex.ru") || url.includes("api.music.yandex.net/dynamic-pages/trigger/polling");
}

export function initFetchInterceptor() {
  if (interceptorInitialized) return;
  interceptorInitialized = true;

  window.fetch = async function (input, init) {
    const url = resolveRequestUrl(input);

    if (isBlockedAnalyticsUrl(url)) {
      return new Response(null, { status: 204 });
    }

    if (url.startsWith("https://api.music.yandex.net")) {
      const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
      return yandexApiFetch(request);
    }

    return originalFetch(input, init);
  };
}

async function yandexApiFetch(initialRequest) {
  let request = initialRequest;

  for (const entry of YandexApiOnRequestHandlers) {
    if (!request.url.includes(entry.url)) continue;
    const override = await entry.handler(request);
    if (override !== undefined && override !== null) {
      request = override instanceof Request ? override : new Request(override, request);
    }
  }

  const matchingResponseHandlers = YandexApiOnResponseHandlers.filter((entry) => request.url.includes(entry.url));
  if (matchingResponseHandlers.length === 0) return originalFetch(request);

  const response = await originalFetch(request);
  let data;

  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  let modifiedData = data;
  let wasModified = false;

  for (const entry of matchingResponseHandlers) {
    const nextValue = await entry.handler({ url: request.url, data: modifiedData });
    if (nextValue !== undefined) {
      modifiedData = nextValue;
      wasModified = true;
    }
  }

  if (!wasModified) return response;

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(JSON.stringify(modifiedData), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function onYandexApiRequest(urlMatch, handler) {
  YandexApiOnRequestHandlers.push({ url: urlMatch, handler });
}

export function onYandexApiResponse(urlMatch, handler) {
  YandexApiOnResponseHandlers.push({ url: urlMatch, handler });
}
