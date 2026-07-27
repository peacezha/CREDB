import type { ChartArea, ChartOptions, ChartType } from 'chart.js';

// Shared Chart.js theme for the navy / burgundy / journal design tokens.
// (Chart canvas configs are exempt from the no-inline-color rule.)

/** Main series palette — cycles navy → burgundy → journal → lighter tints. */
export const CHART_COLORS = [
  '#3d72aa', // navy-500
  '#d64b6d', // burgundy-500
  '#8b7e6a', // journal-500
  '#90b2d8', // navy-300
  '#f0a6b6', // burgundy-300
  '#b8b0a0', // journal-300
];

export const CHART_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const CHART_SERIF_FAMILY = '"Times New Roman", Times, Georgia, serif';
export const CHART_TEXT_COLOR = '#4a4238'; // journal-800
export const CHART_GRID_COLOR = '#e8e5dd'; // journal-100

/** '#rrggbb' → 'rgba(r, g, b, alpha)' for translucent chart fills. */
export const hexToRgba = (hex: string, alpha: number): string => {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Common option baseline for every chart: unified fonts/colors, journal-toned
 * tooltip, and a single ease-out animation. Scale grids are configured per
 * chart (only one axis keeps its lines); spread and override as needed.
 */
export const baseChartOptions = <T extends ChartType>(): ChartOptions<T> =>
  ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 800, easing: 'easeOutQuart' },
  plugins: {
    legend: {
      labels: {
        color: CHART_TEXT_COLOR,
        font: { family: CHART_FONT_FAMILY, size: 11 },
        boxWidth: 12,
        boxHeight: 12,
        padding: 12,
        usePointStyle: true,
      },
    },
    tooltip: {
      backgroundColor: '#15273f', // navy-900
      titleColor: '#ffffff',
      bodyColor: '#ffffff',
      footerColor: '#ffffff',
      padding: 10,
      cornerRadius: 6,
      titleFont: { family: CHART_SERIF_FAMILY, size: 13, weight: 'bold' },
      bodyFont: { family: CHART_FONT_FAMILY, size: 12 },
      boxPadding: 4,
    },
  },
} as ChartOptions<T>);

/** Linear gradient across the chart area, vertical (top→bottom) or horizontal (left→right). */
export const makeGradient = (
  ctx: CanvasRenderingContext2D,
  chartArea: ChartArea,
  from: string,
  to: string,
  axis: 'vertical' | 'horizontal' = 'vertical'
): CanvasGradient => {
  const gradient =
    axis === 'vertical'
      ? ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
      : ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  return gradient;
};
