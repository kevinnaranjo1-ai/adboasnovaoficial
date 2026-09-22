import React, { useState, useEffect, useMemo } from 'react';
import { 
  HeartHandshake, Plus, Search, Filter, Calendar, Clock, Phone, MapPin, 
  Package, ShoppingBag, Shield, CheckCircle2, AlertCircle, X, Trash2, 
  Edit3, Download, Sparkles, MessageCircle, ArrowUpRight, Check, Eye, EyeOff
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, 
  deleteDoc, doc, serverTimestamp 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuthState } from 'react-firebase-hooks/auth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

// Social Assistance Record (Cesta Básica e Ação Social - Diaconia / Reservado)
export interface SocialAssistanceRecord {
  id: string;
  beneficiaryName: string;
  familyMembersCount: number;
  phone?: string;
  address?: string;
  assistanceType: 'Cesta Básica Completa' | 'Cesta de Alimentos Emergencial' | 'Kit de Higiene & Limpeza' | 'Roupas & Agasalhos' | 'Fraldas & Itens de Bebê' | 'Móveis / Utensílios' | 'Outra Ajuda';
  quantity: number;
  deliveryDate: string; // YYYY-MM-DD
  deliveredById?: string;
  deliveredByName?: string;
  situationNotes?: string;
  status: 'Entregue' | 'Agendada' | 'Em Acompanhamento';
  createdAt?: any;
}

// Solidary Item (Varal da Fé / Quero Donar / Preciso - Comunitário)
export interface SolidaryItem {
  id: string;
  type: 'Quero Doar' | 'Estou Precisando';
  title: string;
  category: 'Roupas Infantis / Bebê' | 'Roupas Adulto' | 'Cochinhos & Carrinhos de Bebê' | 'Móveis & Eletrodomésticos' | 'Calçados' | 'Brinquedos' | 'Material Escolar' | 'Outros';
  description: string;
  itemCondition?: 'Novo / Excelente' | 'Bom Estado' | 'Usado' | 'Necessita Reparo Simples';
  contactName: string;
  contactPhone: string;
  contactUserId: string;
  imageUrl?: string;
  status: 'Disponível / Aberto' | 'Concluído / Atendido' | 'Cancelado';
  createdAt?: any;
}

const SOLIDARY_CATEGORIES = [
  'Todos',
  'Roupas Infantis / Bebê',
  'Roupas Adulto',
  'Cochinhos & Carrinhos de Bebê',
  'Móveis & Eletrodomésticos',
  'Calçados',
  'Brinquedos',
  'Material Escolar',
  'Outros'
];

const ASSISTANCE_TYPES = [
  'Cesta Básica Completa',
  'Cesta de Alimentos Emergencial',
  'Kit de Higiene & Limpeza',
  'Roupas & Agasalhos',
  'Fraldas & Itens de Bebê',
  'Móveis / Utensílios',
  'Outra Ajuda'
];

interface SocialActionProps {
  role?: string | null;
}

export default function SocialActionPage({ role }: SocialActionProps) {
  const [user] = useAuthState(auth);
  const [activeTab, setActiveTab] = useState<'varal' | 'baskets'>('varal');

  // Diaconia & Pastoral Permissions for Reserved Assistance Records
  const isDiaconiaOrAdmin = useMemo(() => {
    if (!user) return false;
    if (user.email?.toLowerCase() === 'kevinnaranjo1@gmail.com') return true;
    if (!role) return false;
    const r = role.toLowerCase();
    return ['admin', 'pastor', 'pastora', 'diácono', 'diaconisa', 'obreiro', 'presbítero', 'secretária', 'leader'].includes(r);
  }, [role, user]);

  // Data States
  const [solidaryItems, setSolidaryItems] = useState<SolidaryItem[]>([]);
  const [assistanceRecords, setAssistanceRecords] = useState<SocialAssistanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [varalTypeFilter, setVaralTypeFilter] = useState<'Todos' | 'Quero Doar' | 'Estou Precisando'>('Todos');
  const [varalCategoryFilter, setVaralCategoryFilter] = useState('Todos');
  const [varalSearch, setVaralSearch] = useState('');
  const [basketSearch, setBasketSearch] = useState('');
  const [basketStatusFilter, setBasketStatusFilter] = useState('Todos');

  // Modals
  const [isVaralModalOpen, setIsVaralModalOpen] = useState(false);
  const [isBasketModalOpen, setIsBasketModalOpen] = useState(false);
  const [editingVaralItem, setEditingVaralItem] = useState<SolidaryItem | null>(null);
  const [editingBasketRecord, setEditingBasketRecord] = useState<SocialAssistanceRecord | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; type: 'varal' | 'basket'; name: string } | null>(null);

  // Varal Item Form State
  const [varalForm, setVaralForm] = useState({
    type: 'Quero Doar' as SolidaryItem['type'],
    title: '',
    category: 'Roupas Infantis / Bebê' as SolidaryItem['category'],
    description: '',
    itemCondition: 'Bom Estado' as NonNullable<SolidaryItem['itemCondition']>,
    contactName: user?.displayName || '',
    contactPhone: '',
    status: 'Disponível / Aberto' as SolidaryItem['status']
  });

  // Basket Assistance Form State (Reserved)
  const [basketForm, setBasketForm] = useState({
    beneficiaryName: '',
    familyMembersCount: 4,
    phone: '',
    address: '',
    assistanceType: 'Cesta Básica Completa' as SocialAssistanceRecord['assistanceType'],
    quantity: 1,
    deliveryDate: format(new Date(), 'yyyy-MM-dd'),
    situationNotes: '',
    status: 'Entregue' as SocialAssistanceRecord['status']
  });

  // Listen to collections
  useEffect(() => {
    // Varal da Fé - Community
    const qVaral = query(collection(db, 'solidary_items'), orderBy('createdAt', 'desc'));
    const unsubVaral = onSnapshot(qVaral, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SolidaryItem[];
      setSolidaryItems(list);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'solidary_items');
      setLoading(false);
    });

    // Cesta Básica e Ação Social - Reservado Diaconia
    let unsubAssistance = () => {};
    if (isDiaconiaOrAdmin) {
      const qAssistance = query(collection(db, 'social_assistance'), orderBy('deliveryDate', 'desc'));
      unsubAssistance = onSnapshot(qAssistance, (snapshot) => {
        const list = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as SocialAssistanceRecord[];
        setAssistanceRecords(list);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'social_assistance');
      });
    }

    return () => {
      unsubVaral();
      unsubAssistance();
    };
  }, [isDiaconiaOrAdmin]);

  // Filtered Varal Items
  const filteredVaralItems = useMemo(() => {
    return solidaryItems.filter(item => {
      const matchType = varalTypeFilter === 'Todos' || item.type === varalTypeFilter;
      const matchCat = varalCategoryFilter === 'Todos' || item.category === varalCategoryFilter;
      const matchSearch = !varalSearch ||
        item.title.toLowerCase().includes(varalSearch.toLowerCase()) ||
        item.description.toLowerCase().includes(varalSearch.toLowerCase()) ||
        item.contactName.toLowerCase().includes(varalSearch.toLowerCase());
      return matchType && matchCat && matchSearch;
    });
  }, [solidaryItems, varalTypeFilter, varalCategoryFilter, varalSearch]);

  // Filtered Assistance Records
  const filteredAssistance = useMemo(() => {
    return assistanceRecords.filter(rec => {
      const matchStatus = basketStatusFilter === 'Todos' || rec.status === basketStatusFilter;
      const matchSearch = !basketSearch ||
        rec.beneficiaryName.toLowerCase().includes(basketSearch.toLowerCase()) ||
        rec.assistanceType.toLowerCase().includes(basketSearch.toLowerCase()) ||
        rec.address?.toLowerCase().includes(basketSearch.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [assistanceRecords, basketStatusFilter, basketSearch]);

  // Summary Metrics
  const socialMetrics = useMemo(() => {
    const totalDonations = solidaryItems.filter(i => i.type === 'Quero Doar' && i.status === 'Disponível / Aberto').length;
    const totalRequests = solidaryItems.filter(i => i.type === 'Estou Precisando' && i.status === 'Disponível / Aberto').length;
    const totalAssistedFamilies = assistanceRecords.length;
    const totalBasketsDelivered = assistanceRecords
      .filter(r => r.status === 'Entregue')
      .reduce((acc, curr) => acc + (curr.quantity || 1), 0);

    return { totalDonations, totalRequests, totalAssistedFamilies, totalBasketsDelivered };
  }, [solidaryItems, assistanceRecords]);

  // Open Varal Modal
  const handleOpenVaralModal = (item?: SolidaryItem) => {
    if (item) {
      setEditingVaralItem(item);
      setVaralForm({
        type: item.type,
        title: item.title,
        category: item.category,
        description: item.description,
        itemCondition: item.itemCondition || 'Bom Estado',
        contactName: item.contactName,
        contactPhone: item.contactPhone,
        status: item.status
      });
    } else {
      setEditingVaralItem(null);
      setVaralForm({
        type: 'Quero Doar',
        title: '',
        category: 'Roupas Infantis / Bebê',
        description: '',
        itemCondition: 'Bom Estado',
        contactName: user?.displayName || '',
        contactPhone: '',
        status: 'Disponível / Aberto'
      });
    }
    setIsVaralModalOpen(true);
  };

  // Save Varal Item
  const handleSaveVaral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      if (editingVaralItem) {
        await updateDoc(doc(db, 'solidary_items', editingVaralItem.id), {
          ...varalForm,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'solidary_items'), {
          ...varalForm,
          contactUserId: user.uid,
          createdAt: serverTimestamp()
        });
      }
      setIsVaralModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'solidary_items');
    }
  };

  // Mark Varal item completed
  const handleToggleVaralCompleted = async (item: SolidaryItem) => {
    try {
      const nextStatus = item.status === 'Concluído / Atendido' ? 'Disponível / Aberto' : 'Concluído / Atendido';
      await updateDoc(doc(db, 'solidary_items', item.id), {
        status: nextStatus,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `solidary_items/${item.id}`);
    }
  };

  // Open Basket Modal (Diaconia)
  const handleOpenBasketModal = (record?: SocialAssistanceRecord) => {
    if (record) {
      setEditingBasketRecord(record);
      setBasketForm({
        beneficiaryName: record.beneficiaryName,
        familyMembersCount: record.familyMembersCount || 1,
        phone: record.phone || '',
        address: record.address || '',
        assistanceType: record.assistanceType,
        quantity: record.quantity || 1,
        deliveryDate: record.deliveryDate,
        situationNotes: record.situationNotes || '',
        status: record.status
      });
    } else {
      setEditingBasketRecord(null);
      setBasketForm({
        beneficiaryName: '',
        familyMembersCount: 4,
        phone: '',
        address: '',
        assistanceType: 'Cesta Básica Completa',
        quantity: 1,
        deliveryDate: format(new Date(), 'yyyy-MM-dd'),
        situationNotes: '',
        status: 'Entregue'
      });
    }
    setIsBasketModalOpen(true);
  };

  // Save Basket Record (Diaconia)
  const handleSaveBasket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDiaconiaOrAdmin) return;

    try {
      if (editingBasketRecord) {
        await updateDoc(doc(db, 'social_assistance', editingBasketRecord.id), {
          ...basketForm,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'social_assistance'), {
          ...basketForm,
          deliveredById: user?.uid || '',
          deliveredByName: user?.displayName || user?.email || 'Diácono / Assistente Social',
          createdAt: serverTimestamp()
        });
      }
      setIsBasketModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'social_assistance');
    }
  };

  // Delete Action
  const confirmDelete = async () => {
    if (!deleteItem) return;
    try {
      const col = deleteItem.type === 'varal' ? 'solidary_items' : 'social_assistance';
      await deleteDoc(doc(db, col, deleteItem.id));
      setDeleteItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${deleteItem.type}/${deleteItem.id}`);
    }
  };

  // PDF Export for Diaconia Social Assistance
  const handleDownloadAssistancePDF = () => {
    const docPdf = new jsPDF();
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(20);
    docPdf.setTextColor(15, 23, 42); // church-navy
    docPdf.text('Relatório Confidencial de Ação Social & Diaconia', pageWidth / 2, 20, { align: 'center' });

    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`Igreja Evangélica Assembleia de Deus • Emissão: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

    autoTable(docPdf, {
      startY: 35,
      head: [['Data', 'Família / Beneficiário', 'Pessoas', 'Tipo de Ajuda', 'Qtd', 'Status', 'Observações']],
      body: filteredAssistance.map(a => [
        format(new Date(a.deliveryDate + 'T00:00:00'), 'dd/MM/yyyy'),
        a.beneficiaryName,
        `${a.familyMembersCount} pessoas`,
        a.assistanceType,
        a.quantity.toString(),
        a.status,
        a.situationNotes || '-'
      ]),
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 }
    });

    docPdf.save(`Relatorio_Diaconia_Cestas_Basicas_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto px-2 sm:px-4">
      {/* Top Banner Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black uppercase tracking-wider mb-2">
            <HeartHandshake className="h-3.5 w-3.5 text-rose-600" />
            Amor ao Próximo & Diaconia
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-black text-church-navy">
            Banco Solidário & Ação Social
          </h1>
          <p className="text-church-navy/70 text-sm sm:text-base mt-1">
            Varal da Fé comunitário e registro reservado de cestas básicas para famílias assistidas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'varal' ? (
            <button
              onClick={() => handleOpenVaralModal()}
              className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
            >
              <Plus className="h-4 w-4 text-church-gold" /> Publicar no Varal da Fé
            </button>
          ) : (
            isDiaconiaOrAdmin && (
              <>
                <button
                  onClick={handleDownloadAssistancePDF}
                  className="flex items-center gap-2 rounded-xl border border-church-navy/15 bg-white px-4 py-3 text-xs sm:text-sm font-bold text-church-navy shadow-sm transition hover:bg-church-navy/5 active:scale-95"
                >
                  <Download className="h-4 w-4" /> Relatório Diaconia PDF
                </button>
                <button
                  onClick={() => handleOpenBasketModal()}
                  className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Registrar Ajuda Social / Cesta
                </button>
              </>
            )
          )}
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">Quero Doar (Varal)</span>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1">{socialMetrics.totalDonations}</p>
          <span className="text-[11px] text-emerald-700/70">Itens disponíveis p/ doar</span>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-rose-700 uppercase tracking-wider block">Pedidos / Necessidades</span>
          <p className="text-2xl sm:text-3xl font-black text-rose-600 mt-1">{socialMetrics.totalRequests}</p>
          <span className="text-[11px] text-rose-700/70">Irmãos precisando de auxílio</span>
        </div>

        {isDiaconiaOrAdmin ? (
          <>
            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">Cestas Entregues</span>
              <p className="text-2xl sm:text-3xl font-black text-blue-600 mt-1">{socialMetrics.totalBasketsDelivered}</p>
              <span className="text-[11px] text-blue-700/70">Alimentos distribuídos</span>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-church-navy/60 uppercase tracking-wider block">Famílias Assistidas</span>
              <p className="text-2xl sm:text-3xl font-black text-church-navy mt-1">{socialMetrics.totalAssistedFamilies}</p>
              <span className="text-[11px] text-church-navy/50">Diaconia da congregação</span>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded-2xl bg-church-navy/[0.02] p-4 border border-church-navy/10 flex items-center gap-3">
            <div className="p-3 bg-church-gold/20 rounded-xl text-church-navy">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-church-navy">Compartilhando o Pão e o Amor</p>
              <p className="text-[11px] text-church-navy/60 mt-0.5">"Não se esqueçam da generosidade e de repartir com os outros..." (Hebreus 13:16)</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-church-navy/10 gap-3">
        <button
          onClick={() => setActiveTab('varal')}
          className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'varal'
              ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
              : 'border-transparent text-church-navy/60 hover:text-church-navy'
          }`}
        >
          <ShoppingBag className="h-4 w-4 text-church-gold" />
          <span>Varal da Fé ("Quero Doar / Preciso")</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
            {solidaryItems.length}
          </span>
        </button>

        {isDiaconiaOrAdmin && (
          <button
            onClick={() => setActiveTab('baskets')}
            className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
              activeTab === 'baskets'
                ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
                : 'border-transparent text-church-navy/60 hover:text-church-navy'
            }`}
          >
            <Shield className="h-4 w-4 text-church-gold" />
            <span>Cesta Básica & Diaconia (Reservado)</span>
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
              {assistanceRecords.length}
            </span>
          </button>
        )}
      </div>

      {/* TAB 1: VARAL DA FÉ (COMUNITÁRIO) */}
      {activeTab === 'varal' && (
        <div className="space-y-6">
          {/* Informational Welcome Card */}
          <div className="rounded-3xl bg-gradient-to-r from-church-navy to-church-navy/90 p-5 sm:p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-bold text-church-gold flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" /> Varal da Fé: Doações entre Membros
              </h2>
              <p className="text-white/80 text-xs sm:text-sm max-w-2xl leading-relaxed">
                Tem roupas infantis, carrinhos de bebê, berços ou móveis em bom estado que não usa mais? Ou está precisando para sua família? Anuncie aqui com amor cristão!
              </p>
            </div>
            <button
              onClick={() => handleOpenVaralModal()}
              className="px-4 py-2.5 bg-church-gold hover:bg-church-gold/90 text-church-navy font-black text-xs rounded-xl transition shrink-0 active:scale-95 shadow-md"
            >
              Publicar Agora
            </button>
          </div>

          {/* Search & Filter Bar */}
          <div className="bg-white p-4 rounded-3xl border border-church-navy/10 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-church-navy/40" />
                <input
                  type="text"
                  placeholder="Buscar doação ou pedido (ex: carrinho de bebê, berço, roupas 2 anos...)"
                  value={varalSearch}
                  onChange={(e) => setVaralSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-church-navy/15 text-sm focus:border-church-gold focus:outline-none bg-church-navy/[0.02]"
                />
              </div>

              {/* Type pill */}
              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                {(['Todos', 'Quero Doar', 'Estou Precisando'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setVaralTypeFilter(t)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                      varalTypeFilter === t
                        ? 'bg-church-navy text-white shadow-sm'
                        : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Category horizontal pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-church-navy/5 pb-1">
              <span className="text-xs font-bold text-church-navy/60 mr-1 shrink-0 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Categoria:
              </span>
              {SOLIDARY_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setVaralCategoryFilter(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    varalCategoryFilter === cat
                      ? 'bg-church-gold text-white font-bold'
                      : 'bg-church-navy/[0.03] text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Varal Items Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <Sparkles className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando itens do Varal da Fé...</p>
            </div>
          ) : filteredVaralItems.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <ShoppingBag className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhum item publicado ainda</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Seja o primeiro a doar uma roupinha infantil, móvel ou brinquedo, ou informe algo que sua família está precisando.
              </p>
              <button
                onClick={() => handleOpenVaralModal()}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
              >
                <Plus className="h-4 w-4 text-church-gold" /> Publicar Item
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVaralItems.map(item => {
                const isOwner = user?.uid === item.contactUserId || isDiaconiaOrAdmin;
                const isCompleted = item.status === 'Concluído / Atendido';

                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`rounded-3xl bg-white p-5 border shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 ${
                      isCompleted ? 'opacity-60 border-church-navy/10 bg-church-navy/[0.02]' : 'border-church-navy/10'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Top Type Badge & Category */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-black px-3 py-1 rounded-full ${
                          item.type === 'Quero Doar'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}>
                          {item.type}
                        </span>

                        <span className="text-[11px] font-bold text-church-navy/60 bg-church-navy/5 px-2.5 py-1 rounded-lg">
                          {item.category}
                        </span>
                      </div>

                      {/* Title & Description */}
                      <div>
                        <h4 className={`font-serif text-lg font-bold text-church-navy ${isCompleted ? 'line-through' : ''}`}>
                          {item.title}
                        </h4>
                        <p className="text-xs text-church-navy/70 leading-relaxed mt-1.5 whitespace-pre-line">
                          {item.description}
                        </p>
                      </div>

                      {/* Details Box */}
                      <div className="bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/5 space-y-1.5 text-xs">
                        {item.itemCondition && (
                          <div className="flex items-center justify-between">
                            <span className="text-church-navy/60">Estado do Item:</span>
                            <span className="font-bold text-church-navy">{item.itemCondition}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 border-t border-church-navy/5">
                          <span className="text-church-navy/60">Publicado por:</span>
                          <span className="font-bold text-church-navy">{item.contactName}</span>
                        </div>

                        {item.status && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-church-navy/50">Situação:</span>
                            <span className={`font-bold ${isCompleted ? 'text-emerald-700' : 'text-blue-700'}`}>
                              {item.status}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Contact & Actions Footer */}
                    <div className="pt-3 border-t border-church-navy/5 flex items-center justify-between gap-2">
                      {item.contactPhone && !isCompleted ? (
                        <a
                          href={`https://wa.me/55${item.contactPhone.replace(/\D/g, '')}?text=A%20paz%20do%20Senhor%20irmão(ã)%20${encodeURIComponent(item.contactName)},%20vi%20sua%20publicação%20no%20Varal%20da%20Fé%20("${encodeURIComponent(item.title)}")!`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition"
                        >
                          <Phone className="h-3.5 w-3.5" /> Falar no WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs font-bold text-church-navy/40">
                          {isCompleted ? 'Atendido / Entregue' : 'Sem telefone'}
                        </span>
                      )}

                      {isOwner && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleVaralCompleted(item)}
                            className={`p-1.5 rounded-lg text-xs font-bold transition ${
                              isCompleted 
                                ? 'text-church-navy/60 hover:text-church-navy hover:bg-church-navy/5' 
                                : 'text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title={isCompleted ? 'Reabrir item' : 'Marcar como concluído'}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleOpenVaralModal(item)}
                            className="p-1.5 rounded-lg text-church-navy/60 hover:text-church-navy hover:bg-church-navy/5 transition"
                            title="Editar Publicação"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteItem({ id: item.id, type: 'varal', name: item.title })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                            title="Excluir Publicação"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CESTA BÁSICA & DIACONIA (RESERVADO) */}
      {activeTab === 'baskets' && isDiaconiaOrAdmin && (
        <div className="space-y-6">
          {/* Confidential Notice */}
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-900 flex items-start gap-3 text-xs sm:text-sm">
            <Shield className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Área Restrita da Diaconia e Liderança Pastoral</p>
              <p className="text-amber-800/80 text-xs mt-0.5 leading-relaxed">
                Os dados das famílias que recebem cestas básicas e apoio social são confidenciais e protegidos, garantindo a dignidade de cada irmão e família assistida pela igreja.
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white p-3 rounded-2xl border border-church-navy/10 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-church-navy/40" />
              <input
                type="text"
                placeholder="Buscar por nome da família ou endereço..."
                value={basketSearch}
                onChange={(e) => setBasketSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-church-navy/15 text-xs focus:border-church-gold focus:outline-none bg-church-navy/[0.02]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {['Todos', 'Entregue', 'Agendada', 'Em Acompanhamento'].map(st => (
                <button
                  key={st}
                  onClick={() => setBasketStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                    basketStatusFilter === st
                      ? 'bg-church-navy text-white shadow-sm'
                      : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Assistance Records List */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <Sparkles className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando registros de diaconia...</p>
            </div>
          ) : filteredAssistance.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <Package className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhum registro de cesta básica encontrado</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Registre as entregas de alimentos e kits de assistência para manter o histórico pastoral e a prestação de contas da diaconia.
              </p>
              <button
                onClick={() => handleOpenBasketModal()}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
              >
                <Plus className="h-4 w-4 text-church-gold" /> Registrar Primeira Entrega
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredAssistance.map(rec => (
                <motion.div
                  key={rec.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl bg-white p-5 border border-church-navy/10 shadow-sm hover:shadow-md transition space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-church-gold/15 text-church-navy border border-church-gold/20 flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-church-gold" />
                            {format(new Date(rec.deliveryDate + 'T00:00:00'), 'dd/MM/yyyy')}
                          </span>

                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            rec.status === 'Entregue'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : rec.status === 'Agendada'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {rec.status}
                          </span>
                        </div>

                        <h4 className="font-serif text-lg font-bold text-church-navy">
                          {rec.beneficiaryName}
                        </h4>
                        <p className="text-xs font-medium text-church-navy/60">
                          Família com {rec.familyMembersCount} pessoas • {rec.assistanceType} ({rec.quantity}x)
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenBasketModal(rec)}
                          className="p-1.5 rounded-lg text-church-navy/60 hover:text-church-navy hover:bg-church-navy/5"
                          title="Editar Registro"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteItem({ id: rec.id, type: 'basket', name: rec.beneficiaryName })}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                          title="Excluir Registro"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/5 space-y-1.5 text-xs">
                      {rec.address && (
                        <div className="flex items-center justify-between">
                          <span className="text-church-navy/60 flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-church-gold" /> Endereço:
                          </span>
                          <span className="font-medium text-church-navy line-clamp-1">{rec.address}</span>
                        </div>
                      )}

                      {rec.phone && (
                        <div className="flex items-center justify-between">
                          <span className="text-church-navy/60 flex items-center gap-1">
                            <Phone className="h-3 w-3 text-church-gold" /> Telefone:
                          </span>
                          <a
                            href={`https://wa.me/55${rec.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-emerald-700 hover:underline"
                          >
                            {rec.phone}
                          </a>
                        </div>
                      )}

                      {rec.situationNotes && (
                        <p className="text-[11px] text-church-navy/70 italic pt-1 border-t border-church-navy/5">
                          "{rec.situationNotes}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-church-navy/5 flex items-center justify-between text-[11px] text-church-navy/50">
                    <span>Entregador / Resp: {rec.deliveredByName || 'Diaconia'}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: PUBLICAR NO VARAL DA FÉ */}
      <AnimatePresence>
        {isVaralModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-church-navy/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-church-gold/20"
            >
              <div className="flex items-center justify-between pb-4 border-b border-church-navy/10 mb-6">
                <div>
                  <h3 className="font-serif text-xl font-bold text-church-navy">
                    {editingVaralItem ? 'Editar Publicação' : 'Publicar no Varal da Fé'}
                  </h3>
                  <p className="text-xs text-church-navy/60">Ajuda mútua e doações entre irmãos em Cristo</p>
                </div>
                <button
                  onClick={() => setIsVaralModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveVaral} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-2">
                    Tipo de Publicação *
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setVaralForm({ ...varalForm, type: 'Quero Doar' })}
                      className={`p-3 rounded-2xl border text-center font-bold text-xs transition ${
                        varalForm.type === 'Quero Doar'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white border-church-navy/20 text-church-navy hover:bg-church-navy/5'
                      }`}
                    >
                      🎁 Quero Doar
                    </button>
                    <button
                      type="button"
                      onClick={() => setVaralForm({ ...varalForm, type: 'Estou Precisando' })}
                      className={`p-3 rounded-2xl border text-center font-bold text-xs transition ${
                        varalForm.type === 'Estou Precisando'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'bg-white border-church-navy/20 text-church-navy hover:bg-church-navy/5'
                      }`}
                    >
                      🙏 Estou Precisando
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Título do Item *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Carrinho de bebê Burigotto, Roupas de menino 2-3 anos, Sofá 2 lugares..."
                    value={varalForm.title}
                    onChange={(e) => setVaralForm({ ...varalForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Categoria *
                    </label>
                    <select
                      value={varalForm.category}
                      onChange={(e) => setVaralForm({ ...varalForm, category: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      {SOLIDARY_CATEGORIES.filter(c => c !== 'Todos').map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Estado de Conservação
                    </label>
                    <select
                      value={varalForm.itemCondition}
                      onChange={(e) => setVaralForm({ ...varalForm, itemCondition: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      <option value="Novo / Excelente">Novo / Excelente</option>
                      <option value="Bom Estado">Bom Estado</option>
                      <option value="Usado">Usado</option>
                      <option value="Necessita Reparo Simples">Necessita Reparo Simples</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Descrição & Detalhes
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Descreva cor, tamanho, características e se há facilidade para retirar no templo..."
                    value={varalForm.description}
                    onChange={(e) => setVaralForm({ ...varalForm, description: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Seu Nome *
                    </label>
                    <input
                      type="text"
                      required
                      value={varalForm.contactName}
                      onChange={(e) => setVaralForm({ ...varalForm, contactName: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      WhatsApp para Contato *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="(99) 99999-9999"
                      value={varalForm.contactPhone}
                      onChange={(e) => setVaralForm({ ...varalForm, contactPhone: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsVaralModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    {editingVaralItem ? 'Salvar Alterações' : 'Publicar Item'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: REGISTRAR AJUDA / CESTA BÁSICA (DIACONIA) */}
      <AnimatePresence>
        {isBasketModalOpen && isDiaconiaOrAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-church-navy/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-church-gold/20"
            >
              <div className="flex items-center justify-between pb-4 border-b border-church-navy/10 mb-6">
                <div>
                  <h3 className="font-serif text-xl font-bold text-church-navy">
                    {editingBasketRecord ? 'Editar Registro de Diaconia' : 'Novo Registro de Cesta Básica & Diaconia'}
                  </h3>
                  <p className="text-xs text-church-navy/60">Controle reservado do ministério de ação social</p>
                </div>
                <button
                  onClick={() => setIsBasketModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveBasket} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Nome da Família / Responsável *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Família Silva (Dona Maria)"
                    value={basketForm.beneficiaryName}
                    onChange={(e) => setBasketForm({ ...basketForm, beneficiaryName: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Tipo de Assistência *
                    </label>
                    <select
                      value={basketForm.assistanceType}
                      onChange={(e) => setBasketForm({ ...basketForm, assistanceType: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      {ASSISTANCE_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Quantidade
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={basketForm.quantity}
                      onChange={(e) => setBasketForm({ ...basketForm, quantity: parseInt(e.target.value) || 1 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Membros na Família
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={basketForm.familyMembersCount}
                      onChange={(e) => setBasketForm({ ...basketForm, familyMembersCount: parseInt(e.target.value) || 1 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Data da Entrega *
                    </label>
                    <input
                      type="date"
                      required
                      value={basketForm.deliveryDate}
                      onChange={(e) => setBasketForm({ ...basketForm, deliveryDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Telefone da Família
                    </label>
                    <input
                      type="tel"
                      placeholder="(99) 99999-9999"
                      value={basketForm.phone}
                      onChange={(e) => setBasketForm({ ...basketForm, phone: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Status da Entrega
                    </label>
                    <select
                      value={basketForm.status}
                      onChange={(e) => setBasketForm({ ...basketForm, status: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none font-medium"
                    >
                      <option value="Entregue">Entregue</option>
                      <option value="Agendada">Agendada</option>
                      <option value="Em Acompanhamento">Em Acompanhamento</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Endereço da Família
                  </label>
                  <input
                    type="text"
                    placeholder="Rua, número e bairro para visita da diaconia"
                    value={basketForm.address}
                    onChange={(e) => setBasketForm({ ...basketForm, address: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Notas da Situação / Acompanhamento Pastoral
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Informações sobre desemprego, saúde ou acompanhamento com oração..."
                    value={basketForm.situationNotes}
                    onChange={(e) => setBasketForm({ ...basketForm, situationNotes: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsBasketModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    {editingBasketRecord ? 'Atualizar Registro' : 'Salvar Registro'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONFIRMATION MODAL */}
      <DeleteConfirmationModal
        isOpen={Boolean(deleteItem)}
        title={deleteItem?.type === 'varal' ? 'Excluir Item do Varal' : 'Excluir Registro de Assistência'}
        message={`Tem certeza que deseja remover "${deleteItem?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={confirmDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
