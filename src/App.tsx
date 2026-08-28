import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth, RequireShop, Splash } from '@/components/layout/Guards'
import { ROUTES } from '@/lib/constants'

// Core screens loaded eagerly for instant first paint
import Home from '@/screens/Home'
import Sell from '@/screens/sell/Sell'
import Products from '@/screens/products/Products'
import Khata from '@/screens/khata/Khata'
import Login from '@/screens/auth/Login'
import Signup from '@/screens/auth/Signup'

// Secondary screens code-split on demand
const Onboarding = lazy(() => import('@/screens/auth/Onboarding'))
const AcceptInvite = lazy(() => import('@/screens/auth/AcceptInvite'))
const ProductForm = lazy(() => import('@/screens/products/ProductForm'))
const Stock = lazy(() => import('@/screens/products/Stock'))
const PartyDetail = lazy(() => import('@/screens/khata/PartyDetail'))
const Suppliers = lazy(() => import('@/screens/suppliers/Suppliers'))
const SupplierDetail = lazy(() => import('@/screens/suppliers/SupplierDetail'))
const Purchases = lazy(() => import('@/screens/purchases/Purchases'))
const PurchaseNew = lazy(() => import('@/screens/purchases/PurchaseNew'))
const PurchaseDetail = lazy(() => import('@/screens/purchases/PurchaseDetail'))
const Expenses = lazy(() => import('@/screens/expenses/Expenses'))
const Reports = lazy(() => import('@/screens/reports/Reports'))
const Settings = lazy(() => import('@/screens/settings/Settings'))
const Staff = lazy(() => import('@/screens/settings/Staff'))
const StaffSales = lazy(() => import('@/screens/settings/StaffSales'))
const Billing = lazy(() => import('@/screens/settings/Billing'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Splash />}>
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
              <Route path={ROUTES.staffSales} element={<StaffSales />} />
              <Route path={ROUTES.billing} element={<Billing />} />
            </Route>
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
