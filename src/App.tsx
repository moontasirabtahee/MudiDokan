import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth, RequireShop } from '@/components/layout/Guards'
import { ROUTES } from '@/lib/constants'
import AcceptInvite from '@/screens/auth/AcceptInvite'
import Login from '@/screens/auth/Login'
import Onboarding from '@/screens/auth/Onboarding'
import Signup from '@/screens/auth/Signup'
import Expenses from '@/screens/expenses/Expenses'
import Home from '@/screens/Home'
import Khata from '@/screens/khata/Khata'
import PartyDetail from '@/screens/khata/PartyDetail'
import ProductForm from '@/screens/products/ProductForm'
import Products from '@/screens/products/Products'
import Stock from '@/screens/products/Stock'
import PurchaseDetail from '@/screens/purchases/PurchaseDetail'
import PurchaseNew from '@/screens/purchases/PurchaseNew'
import Purchases from '@/screens/purchases/Purchases'
import Reports from '@/screens/reports/Reports'
import Sell from '@/screens/sell/Sell'
import Billing from '@/screens/settings/Billing'
import Settings from '@/screens/settings/Settings'
import Staff from '@/screens/settings/Staff'
import SupplierDetail from '@/screens/suppliers/SupplierDetail'
import Suppliers from '@/screens/suppliers/Suppliers'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public / Auth Routes ───────────────────────────────────────── */}
        <Route path={ROUTES.login} element={<Login />} />
        <Route path={ROUTES.signup} element={<Signup />} />
        <Route path={ROUTES.invite} element={<AcceptInvite />} />

        {/* ── Authenticated but may need Shop Setup ──────────────────────── */}
        <Route element={<RequireAuth />}>
          <Route path={ROUTES.onboarding} element={<Onboarding />} />

          {/* ── Signed-in and Tenant-Scoped (AppShell) ────────────────────── */}
          <Route element={<RequireShop />}>
            <Route element={<AppShell />}>
              <Route path={ROUTES.home} element={<Home />} />
              <Route path={ROUTES.sell} element={<Sell />} />

              {/* Products & Inventory */}
              <Route path={ROUTES.products} element={<Products />} />
              <Route path={ROUTES.productNew} element={<ProductForm />} />
              <Route path="/products/:id" element={<ProductForm />} />
              <Route path={ROUTES.stock} element={<Stock />} />

              {/* Khata (Party Dues & Statements) */}
              <Route path={ROUTES.khata} element={<Khata />} />
              <Route path="/khata/:id" element={<PartyDetail />} />

              {/* Suppliers */}
              <Route path={ROUTES.suppliers} element={<Suppliers />} />
              <Route path="/suppliers/:id" element={<SupplierDetail />} />

              {/* Purchases */}
              <Route path={ROUTES.purchases} element={<Purchases />} />
              <Route path="/purchases/new" element={<PurchaseNew />} />
              <Route path="/purchases/:id" element={<PurchaseDetail />} />

              {/* Expenses */}
              <Route path={ROUTES.expenses} element={<Expenses />} />

              {/* Reports */}
              <Route path={ROUTES.reports} element={<Reports />} />

              {/* Settings */}
              <Route path={ROUTES.settings} element={<Settings />} />
              <Route path={ROUTES.staff} element={<Staff />} />
              <Route path={ROUTES.billing} element={<Billing />} />
            </Route>
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
