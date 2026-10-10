import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '@/i18n';
import Login from './Login';

const setupStatus = vi.fn();
vi.mock('@/api/auth.api', () => ({
  authApi: {
    setupStatus: () => setupStatus(),
    trustedPeek: () => Promise.reject(new Error('no trusted device')),
  },
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<div>SETUP WIZARD</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Login first-run redirect', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('hands over to the setup wizard while no user exists', async () => {
    setupStatus.mockResolvedValue({ needsSetup: true });
    renderLogin();
    expect(await screen.findByText('SETUP WIZARD')).toBeInTheDocument();
  });

  it('stays on the login form once a user exists', async () => {
    setupStatus.mockResolvedValue({ needsSetup: false });
    renderLogin();
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.queryByText('SETUP WIZARD')).not.toBeInTheDocument();
  });

  it('stays on the login form when the status check fails', async () => {
    setupStatus.mockRejectedValue(new Error('network'));
    renderLogin();
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
  });
});
