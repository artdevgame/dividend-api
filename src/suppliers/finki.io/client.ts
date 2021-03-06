import config from 'config';
import fetch, { Response } from 'node-fetch';

import * as cache from '../../helpers/cache';
import { CacheOptions, ContentType } from '../../helpers/cache';
import { round } from '../../helpers/number';

interface CalculateDividendYield {
  cacheOptions: CacheOptions;
  symbol: string;
  isin: string;
}

interface FetchDividendParamssForSymbol {
  symbol: string;
}

interface FetchDividendParamsIsin {
  symbol: string;
}

interface FetchDividendParamsYield {
  symbol: string;
  isin: string;
}

async function calculateDividendYield({ cacheOptions, symbol, isin }: CalculateDividendYield) {
  try {
    const apiKey = config.get('suppliers.finkio.key');
    const dividendInfo = await Promise.all([
      fetch(`https://finki.io/callAPI.php?isin=${isin}&key=${apiKey}&function=dividendAnnual`),
      fetch(`https://finki.io/callAPI.php?isin=${isin}&key=${apiKey}&function=bid`),
    ]);

    const [dividendAnnual, currentSellPrice] = await Promise.all(
      dividendInfo.map((res) => {
        if (!res.ok || hasError(res)) {
          throw new Error(`Unable to calculate dividendYield, FinkIO API responded poorly: ${isin} (${symbol})`);
        }
        return Number(res.text());
      }),
    );

    const dividendYield = round(dividendAnnual / currentSellPrice, 2);

    cache.writeToCache(dividendYield, cacheOptions);

    return dividendYield;
  } catch (err) {
    console.error(err.message);
    return 0;
  }
}

async function fetchDividendIsin({ symbol }: FetchDividendParamsIsin): Promise<string> {
  const cacheOptions = { contentType: ContentType.TEXT, filename: 'isin.txt', path: `${__dirname}/.cache/${symbol}` };
  const cachedIsin = cache.readFromCache<string>(cacheOptions);

  if (typeof cachedIsin !== 'undefined') {
    return cachedIsin;
  }

  const isinRes = await fetch(`https://finki.io/isinAPI.php?ticker=${symbol}`);

  if (!isinRes.ok || (await hasError(isinRes))) {
    throw new Error(`Unable to find isin with symbol: ${symbol}`);
  }

  const isin = (await isinRes.text()).trim();

  cache.writeToCache(isin, cacheOptions);

  return isin;
}

async function fetchDividendYield({ isin, symbol }: FetchDividendParamsYield) {
  const cacheOptions = { filename: 'dividend-yield.txt', path: `${__dirname}/.cache/${symbol}` };
  const cachedDividendYield = cache.readFromCache<string>(cacheOptions);

  if (typeof cachedDividendYield !== 'undefined') {
    return cachedDividendYield;
  }

  const apiKey = config.get('suppliers.finkio.key');
  const dividendYieldRes = await fetch(
    `https://finki.io/callAPI.php?isin=${isin}&key=${apiKey}&function=dividendYield`,
  );

  if (!dividendYieldRes.ok) {
    throw new Error(`Unable to find company with symbol: ${symbol}`);
  }

  if (await hasError(dividendYieldRes)) {
    console.log('Unable to retrieve yield with `dividendYield` function', symbol);
    return calculateDividendYield({ cacheOptions, symbol, isin });
  }

  const dividendYield = (await dividendYieldRes.text()).trim();

  cache.writeToCache(dividendYield, cacheOptions);

  return Number(dividendYield);
}

async function hasError(apiResponse: Response) {
  const responseBody = (await apiResponse.clone().text()).toLowerCase();
  return (
    responseBody.includes('temporarilyunavailable') ||
    responseBody.includes('no.data.found') ||
    responseBody.includes('invalidorunrecognizedresponse')
  );
}

export async function fetchDividendsForSymbol({ symbol }: FetchDividendParamssForSymbol) {
  try {
    const isin = await fetchDividendIsin({ symbol });

    if (typeof isin === 'undefined') {
      throw new Error(`Couldn't match dividend on symbol name: ${symbol}`);
    }

    return fetchDividendYield({ isin, symbol });
  } catch (err) {
    console.error(err.message);
    return 0;
  }
}
