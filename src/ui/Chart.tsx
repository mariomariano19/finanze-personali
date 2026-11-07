import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

/** Grafico ECharts: si ridisegna ogni volta che cambiano i dati (quindi a ogni inserimento/modifica) */
export function Chart({ option, height, label }: { option: EChartsCoreOption; height: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, undefined, { renderer: 'svg' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className="chart" style={{ height }} role="img" aria-label={label} />;
}

export const FONT = 'Inter, -apple-system, system-ui, sans-serif';
export const AXIS = { color: '#5b6169', fontSize: 11, fontFamily: FONT };
export const TOOLTIP = {
  trigger: 'axis' as const,
  confine: true,
  backgroundColor: '#111316',
  borderWidth: 0,
  textStyle: { color: '#fff', fontFamily: FONT, fontSize: 12 }
};

// Scale di colore ordinate per luminosità: si distinguono anche senza percepire la tinta
export const EXPENSE_SCALE = ['#7a2e05', '#b54708', '#e0701f', '#f59e5b', '#f8be8e', '#fbd9bc', '#fde9d7'];
export const INCOME_SCALE = ['#1d4ed8', '#5b8def', '#9dbcf7', '#c8d9fb', '#dfe9fd', '#eef3fe'];
export const INVEST_SCALE = ['#075e46', '#0b7a5c', '#3faf8a', '#8fd6bc', '#c6ebdd', '#e2f5ee', '#f0faf6', '#f7fcfa'];

/** Raggruppa le fette oltre il limite in "Altro" */
export function topSlices<T extends { name: string; amount: number }>(slices: T[], max: number) {
  if (slices.length <= max) return slices.map((s) => ({ name: s.name, amount: s.amount }));
  const head = slices.slice(0, max - 1).map((s) => ({ name: s.name, amount: s.amount }));
  const rest = slices.slice(max - 1).reduce((s, x) => s + x.amount, 0);
  return [...head, { name: 'Altro', amount: rest }];
}

export function donutOption(slices: { name: string; amount: number }[], colors: string[]): EChartsCoreOption {
  return {
    animationDuration: 300,
    tooltip: { ...TOOLTIP, trigger: 'item', valueFormatter: (v: number) => `${(v / 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €` },
    series: [
      {
        type: 'pie',
        radius: ['58%', '92%'],
        avoidLabelOverlap: false,
        label: { show: false },
        itemStyle: { borderColor: '#fff', borderWidth: slices.length > 1 ? 2 : 0 },
        data: slices.map((s, i) => ({ name: s.name, value: s.amount, itemStyle: { color: colors[Math.min(i, colors.length - 1)] } }))
      }
    ]
  };
}
