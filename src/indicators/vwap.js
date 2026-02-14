export function computeSessionVwap(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return null;

  let pv = 0;
  let v = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    v += c.volume;
  }
  if (v === 0) return null;
  return pv / v;
}

export function computeVwapSeries(candles) {
  const series = [];
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV += c.volume;
    series.push(cumV === 0 ? null : cumPV / cumV);
  }
  return series;
}
