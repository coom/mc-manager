import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { PlayersChart } from './PlayersChart';

vi.mock('@/api/metrics.api', () => ({ metricsApi: { series: vi.fn().mockResolvedValue({ points: [] }) } }));
// Le rendu SVG n'est pas l'objet du test (et ResponsiveContainer mesure 0 x 0 sous jsdom).
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Area: Stub, AreaChart: Stub, CartesianGrid: Stub, ResponsiveContainer: Stub, Tooltip: Stub, XAxis: Stub, YAxis: Stub };
});

function renderChart() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><PlayersChart /></QueryClientProvider>);
}

describe('PlayersChart range tabs', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('labels the ranges in English', async () => {
    await i18n.changeLanguage('en');
    renderChart();
    expect(screen.getByRole('tab', { name: '24h' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '7d' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '30d' })).toBeInTheDocument();
  });

  it('labels the ranges in French', async () => {
    await i18n.changeLanguage('fr');
    renderChart();
    expect(screen.getByRole('tab', { name: '7j' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '30j' })).toBeInTheDocument();
  });
});
