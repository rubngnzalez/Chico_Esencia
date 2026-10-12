import { lazy, Suspense } from 'react'
import { Route, Routes, Outlet } from 'react-router-dom'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import HomePage from './pages/HomePage'
import ArticlePage from './pages/ArticlePage'
import CategoryPage from './pages/CategoryPage'
import SearchPage from './pages/SearchPage'
import ManifiestoPage from './pages/ManifiestoPage'
import NotFoundPage from './pages/NotFoundPage'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const LoginPage = lazy(() => import('./pages/admin/LoginPage'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const ArticlesPage = lazy(() => import('./pages/admin/ArticlesPage'))
const ArticleEditorPage = lazy(() => import('./pages/admin/ArticleEditorPage'))
const ImporterPage = lazy(() => import('./pages/admin/ImporterPage'))
const WidgetsPage = lazy(() => import('./pages/admin/WidgetsPage'))
const CommentsPage = lazy(() => import('./pages/admin/CommentsPage'))
const CategoriesPage = lazy(() => import('./pages/admin/CategoriesPage'))
const UsersPage = lazy(() => import('./pages/admin/UsersPage'))
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'))

function PublicLayout() {
  return (
    <div className="fondo-diario">
      <SiteHeader />
      <main>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}

function Cargando() {
  return <div className="admin-carga">Cargando…</div>
}

export default function App() {
  return (
    <Suspense fallback={<Cargando />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/articulo/:slug" element={<ArticlePage />} />
          <Route path="/categoria/:slug" element={<CategoryPage />} />
          <Route path="/busqueda" element={<SearchPage />} />
          <Route path="/manifiesto" element={<ManifiestoPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="articulos" element={<ArticlesPage />} />
          <Route path="articulos/nuevo" element={<ArticleEditorPage />} />
          <Route path="articulos/:id/editar" element={<ArticleEditorPage />} />
          <Route path="importador" element={<ImporterPage />} />
          <Route path="widgets" element={<WidgetsPage />} />
          <Route path="comentarios" element={<CommentsPage />} />
          <Route path="categorias" element={<CategoriesPage />} />
          <Route path="colaboradores" element={<UsersPage />} />
          <Route path="ajustes" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
