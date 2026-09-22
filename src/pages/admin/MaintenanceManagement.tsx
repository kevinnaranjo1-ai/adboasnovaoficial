import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, Wrench, Shield, Plus, Search, Filter, Calendar, Clock, 
  MapPin, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Trash2, 
  Edit3, Phone, Check, ChevronRight, Download, Users, X, ArrowUpRight, 
  Mic, Volume2, Tv, Wind, Zap, Disc, FileText, CheckSquare, Square
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { 
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, 
  deleteDoc, doc, serverTimestamp, where 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuthState } from 'react-firebase-hooks/auth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';

export interface AssetEquipment {
  id: string;
  name: string;
  category: 'Microfones' | 'Cabos & Conectores' | 'Instrumentos Musicais' | 'Som & Áudio' | 'Projetores & Telões' | 'Ar Condicionado & Ventilação' | 'Iluminação' | 'Mobiliário' | 'Outros';
  quantity: number;
  condition: 'Novo' | 'Bom' | 'Regular' | 'Precisa de Manutenção' | 'Danificado';
  status: 'Em uso' | 'Em manutenção' | 'Reparado' | 'Reserva / Almoxarifado' | 'Baixado';
  location: string;
  serialNumber?: string;
  notes?: string;
  lastInventoryDate: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface CleaningChecklistItem {
  id: string;
  task: string;
  area: string;
  completed: boolean;
  completedBy?: string;
}

export interface CleaningSchedule {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  targetService: string; // ex: "Culto de Domingo 18h", "Culto de Ensino", "Vigília", etc.
  leaderName: string;
  leaderPhone?: string;
  teamMembers: string[];
  areas: string[]; // "Nave do Templo / Altar", "Banheiros", "Sala das Crianças", "Cozinha", etc.
  checklist: CleaningChecklistItem[];
  status: 'Agendada' | 'Em andamento' | 'Concluída' | 'Cancelada';
  observations?: string;
  completedAt?: string;
  createdAt?: any;
}

interface MaintenancePageProps {
  role?: string | null;
}

const ASSET_CATEGORIES = [
  'Todos',
  'Microfones',
  'Cabos & Conectores',
  'Instrumentos Musicais',
  'Som & Áudio',
  'Projetores & Telões',
  'Ar Condicionado & Ventilação',
  'Iluminação',
  'Mobiliário',
  'Outros'
];

const DEFAULT_CLEANING_AREAS = [
  'Altar e Púlpito',
  'Nave do Templo e Cadeiras',
  'Banheiros Masculino e Feminino',
  'Sala das Crianças / Kids',
  'Cabine de Som e Mídia',
  'Entrada / Calçada / Portaria',
  'Cozinha / Refeitório',
  'Bebedouros e Corredores'
];

const DEFAULT_TASKS_BY_AREA: Record<string, string[]> = {
  'Altar e Púlpito': ['Varrer e passar pano no altar', 'Limpar púlpito e mesa de apoio', 'Aspirar ou organizar tapete'],
  'Nave do Templo e Cadeiras': ['Alinhar e higienizar cadeiras', 'Varrer e passar pano perfumado no piso', 'Recolher papéis e garrafas'],
  'Banheiros Masculino e Feminino': ['Lavar pias e vasos sanitários', 'Repor papel higiênico, toalha e sabonete', 'Esvaziar lixeiras e trocar sacos'],
  'Sala das Crianças / Kids': ['Organizar brinquedos e mesinhas', 'Higienizar tatame/colchonetes', 'Varrer e passar pano'],
  'Cabine de Som e Mídia': ['Tirar poeira das mesas e computadores', 'Organizar cabos e guardar microfones'],
  'Entrada / Calçada / Portaria': ['Varrer calçada e rampa de acesso', 'Limpar vidros e portas de entrada'],
  'Cozinha / Refeitório': ['Lavar louças e secar bancadas', 'Esvaziar lixeiras', 'Limpar fogão e geladeira'],
  'Bebedouros e Corredores': ['Higienizar torneiras dos bebedouros', 'Limpar pingadeiras e piso ao redor']
};

export default function MaintenanceManagement({ role }: MaintenancePageProps) {
  const [user] = useAuthState(auth);
  const [activeTab, setActiveTab] = useState<'cleaning' | 'inventory'>('cleaning');

  // Equipments & Assets State
  const [assets, setAssets] = useState<AssetEquipment[]>([]);
  const [assetCategoryFilter, setAssetCategoryFilter] = useState('Todos');
  const [assetStatusFilter, setAssetStatusFilter] = useState('Todos');
  const [assetSearch, setAssetSearch] = useState('');

  // Cleaning Schedules State
  const [schedules, setSchedules] = useState<CleaningSchedule[]>([]);
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState('Todos');

  // Loading & Modals
  const [loading, setLoading] = useState(true);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetEquipment | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<CleaningSchedule | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; type: 'asset' | 'schedule'; name: string } | null>(null);

  // Members list for suggestions
  const [membersList, setMembersList] = useState<{ id: string; name: string; phone?: string; department?: string }[]>([]);

  // Permission: pastor, pastora, admin, porteiro zelador, obreiro, diácono
  const canManage = useMemo(() => {
    if (!user) return false;
    if (user.email?.toLowerCase() === 'kevinnaranjo1@gmail.com') return true;
    if (!role) return false;
    const r = role.toLowerCase();
    return ['admin', 'pastor', 'pastora', 'secretária', 'porteiro zelador', 'zelador', 'diácono', 'obreiro', 'leader'].includes(r);
  }, [role, user]);

  // Asset Form State
  const [assetForm, setAssetForm] = useState({
    name: '',
    category: 'Microfones' as AssetEquipment['category'],
    quantity: 1,
    condition: 'Bom' as AssetEquipment['condition'],
    status: 'Em uso' as AssetEquipment['status'],
    location: 'Templo Sede',
    serialNumber: '',
    notes: '',
    lastInventoryDate: format(new Date(), 'yyyy-MM-dd')
  });

  // Schedule Form State
  const [scheduleForm, setScheduleForm] = useState({
    title: 'Limpeza Geral para o Culto de Domingo',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '09:00',
    targetService: 'Culto de Domingo (18h)',
    leaderName: '',
    leaderPhone: '',
    teamMembersInput: '',
    selectedAreas: ['Altar e Púlpito', 'Nave do Templo e Cadeiras', 'Banheiros Masculino e Feminino'] as string[],
    observations: ''
  });

  // Listen to assets
  useEffect(() => {
    const qAssets = query(collection(db, 'assets'), orderBy('name', 'asc'));
    const unsubAssets = onSnapshot(qAssets, (snapshot) => {
      const data = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as AssetEquipment[];
      setAssets(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'assets');
    });

    // Listen to cleaning schedules
    const qClean = query(collection(db, 'cleaning_schedules'), orderBy('date', 'desc'));
    const unsubClean = onSnapshot(qClean, (snapshot) => {
      const data = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as CleaningSchedule[];
      setSchedules(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cleaning_schedules');
      setLoading(false);
    });

    // Listen to members for quick picker
    const qMembers = query(collection(db, 'members'), orderBy('name', 'asc'));
    const unsubMembers = onSnapshot(qMembers, (snapshot) => {
      const mList = snapshot.docs.map(d => ({
        id: d.id,
        name: d.data().name || '',
        phone: d.data().whatsapp || d.data().phone || '',
        department: d.data().department || ''
      }));
      setMembersList(mList);
    });

    return () => {
      unsubAssets();
      unsubClean();
      unsubMembers();
    };
  }, []);

  // Filtered Assets
  const filteredAssets = useMemo(() => {
    return assets.filter(a => {
      const matchCategory = assetCategoryFilter === 'Todos' || a.category === assetCategoryFilter;
      const matchStatus = assetStatusFilter === 'Todos' || a.status === assetStatusFilter;
      const matchSearch = !assetSearch || 
        a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
        a.location?.toLowerCase().includes(assetSearch.toLowerCase()) ||
        a.serialNumber?.toLowerCase().includes(assetSearch.toLowerCase());
      return matchCategory && matchStatus && matchSearch;
    });
  }, [assets, assetCategoryFilter, assetStatusFilter, assetSearch]);

  // Filtered Schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      if (scheduleStatusFilter === 'Todos') return true;
      return s.status === scheduleStatusFilter;
    });
  }, [schedules, scheduleStatusFilter]);

  // Asset Status count metrics
  const assetMetrics = useMemo(() => {
    const total = assets.reduce((acc, curr) => acc + (curr.quantity || 1), 0);
    const inUse = assets.filter(a => a.status === 'Em uso').reduce((acc, curr) => acc + (curr.quantity || 1), 0);
    const inMaintenance = assets.filter(a => a.status === 'Em manutenção' || a.condition === 'Precisa de Manutenção').reduce((acc, curr) => acc + (curr.quantity || 1), 0);
    const repaired = assets.filter(a => a.status === 'Reparado').reduce((acc, curr) => acc + (curr.quantity || 1), 0);
    return { total, inUse, inMaintenance, repaired, totalDistinct: assets.length };
  }, [assets]);

  // Open asset modal for create or edit
  const handleOpenAssetModal = (asset?: AssetEquipment) => {
    if (asset) {
      setEditingAsset(asset);
      setAssetForm({
        name: asset.name,
        category: asset.category || 'Outros',
        quantity: asset.quantity || 1,
        condition: asset.condition || 'Bom',
        status: asset.status || 'Em uso',
        location: asset.location || 'Templo Sede',
        serialNumber: asset.serialNumber || '',
        notes: asset.notes || '',
        lastInventoryDate: asset.lastInventoryDate || format(new Date(), 'yyyy-MM-dd')
      });
    } else {
      setEditingAsset(null);
      setAssetForm({
        name: '',
        category: 'Microfones',
        quantity: 1,
        condition: 'Bom',
        status: 'Em uso',
        location: 'Templo Sede',
        serialNumber: '',
        notes: '',
        lastInventoryDate: format(new Date(), 'yyyy-MM-dd')
      });
    }
    setIsAssetModalOpen(true);
  };

  // Submit asset
  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    try {
      if (editingAsset) {
        await updateDoc(doc(db, 'assets', editingAsset.id), {
          ...assetForm,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'assets'), {
          ...assetForm,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setIsAssetModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'assets');
    }
  };

  // Open schedule modal
  const handleOpenScheduleModal = (schedule?: CleaningSchedule) => {
    if (schedule) {
      setEditingSchedule(schedule);
      setScheduleForm({
        title: schedule.title,
        date: schedule.date,
        time: schedule.time,
        targetService: schedule.targetService,
        leaderName: schedule.leaderName,
        leaderPhone: schedule.leaderPhone || '',
        teamMembersInput: (schedule.teamMembers || []).join(', '),
        selectedAreas: schedule.areas || [],
        observations: schedule.observations || ''
      });
    } else {
      setEditingSchedule(null);
      setScheduleForm({
        title: 'Limpeza & Cuidados para o Culto',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: '09:00',
        targetService: 'Culto de Domingo (18h)',
        leaderName: '',
        leaderPhone: '',
        teamMembersInput: '',
        selectedAreas: ['Altar e Púlpito', 'Nave do Templo e Cadeiras', 'Banheiros Masculino e Feminino'],
        observations: ''
      });
    }
    setIsScheduleModalOpen(true);
  };

  // Submit cleaning schedule
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    const teamMembers = scheduleForm.teamMembersInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Build initial checklist items from selected areas
    let checklist: CleaningChecklistItem[] = [];
    if (editingSchedule && editingSchedule.checklist?.length > 0) {
      // keep existing status for unchanged areas, append new ones
      checklist = [...editingSchedule.checklist];
      scheduleForm.selectedAreas.forEach(area => {
        const areaExists = checklist.some(item => item.area === area);
        if (!areaExists) {
          const tasks = DEFAULT_TASKS_BY_AREA[area] || [`Higienizar e organizar ${area}`];
          tasks.forEach((t, i) => {
            checklist.push({
              id: `${area}-${i}-${Date.now()}`,
              area,
              task: t,
              completed: false
            });
          });
        }
      });
    } else {
      scheduleForm.selectedAreas.forEach(area => {
        const tasks = DEFAULT_TASKS_BY_AREA[area] || [`Higienizar e organizar ${area}`];
        tasks.forEach((t, i) => {
          checklist.push({
            id: `${area}-${i}-${Date.now()}`,
            area,
            task: t,
            completed: false
          });
        });
      });
    }

    try {
      if (editingSchedule) {
        await updateDoc(doc(db, 'cleaning_schedules', editingSchedule.id), {
          title: scheduleForm.title,
          date: scheduleForm.date,
          time: scheduleForm.time,
          targetService: scheduleForm.targetService,
          leaderName: scheduleForm.leaderName,
          leaderPhone: scheduleForm.leaderPhone,
          teamMembers,
          areas: scheduleForm.selectedAreas,
          checklist,
          observations: scheduleForm.observations,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'cleaning_schedules'), {
          title: scheduleForm.title,
          date: scheduleForm.date,
          time: scheduleForm.time,
          targetService: scheduleForm.targetService,
          leaderName: scheduleForm.leaderName,
          leaderPhone: scheduleForm.leaderPhone,
          teamMembers,
          areas: scheduleForm.selectedAreas,
          checklist,
          status: 'Agendada',
          observations: scheduleForm.observations,
          createdAt: serverTimestamp()
        });
      }
      setIsScheduleModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'cleaning_schedules');
    }
  };

  // Toggle single checklist task
  const handleToggleTask = async (schedule: CleaningSchedule, taskId: string) => {
    const updatedChecklist = schedule.checklist.map(item => {
      if (item.id === taskId) {
        const nextState = !item.completed;
        return {
          ...item,
          completed: nextState,
          completedBy: nextState ? (user?.displayName || user?.email || 'Membro') : undefined
        };
      }
      return item;
    });

    const allCompleted = updatedChecklist.length > 0 && updatedChecklist.every(i => i.completed);
    const anyCompleted = updatedChecklist.some(i => i.completed);

    let nextStatus: CleaningSchedule['status'] = schedule.status;
    if (allCompleted) {
      nextStatus = 'Concluída';
    } else if (anyCompleted && schedule.status === 'Agendada') {
      nextStatus = 'Em andamento';
    }

    try {
      await updateDoc(doc(db, 'cleaning_schedules', schedule.id), {
        checklist: updatedChecklist,
        status: nextStatus,
        completedAt: allCompleted ? new Date().toISOString() : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `cleaning_schedules/${schedule.id}`);
    }
  };

  // Update schedule status directly
  const handleUpdateScheduleStatus = async (id: string, status: CleaningSchedule['status']) => {
    try {
      await updateDoc(doc(db, 'cleaning_schedules', id), {
        status,
        completedAt: status === 'Concluída' ? new Date().toISOString() : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `cleaning_schedules/${id}`);
    }
  };

  // Delete item handler
  const confirmDelete = async () => {
    if (!deleteItem || !canManage) return;
    try {
      const col = deleteItem.type === 'asset' ? 'assets' : 'cleaning_schedules';
      await deleteDoc(doc(db, col, deleteItem.id));
      setDeleteItem(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${deleteItem.type}/${deleteItem.id}`);
    }
  };

  // PDF Export for Inventory & Equipment
  const handleDownloadInventoryPDF = () => {
    const docPdf = new jsPDF();
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(20);
    docPdf.setTextColor(15, 23, 42); // church-navy
    docPdf.text('Inventário e Patrimônio da Igreja', pageWidth / 2, 20, { align: 'center' });

    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`Igreja Evangélica Assembleia de Deus • Emitido em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

    // Summary block
    autoTable(docPdf, {
      startY: 35,
      head: [['Total de Itens', 'Em Uso Ativo', 'Em Manutenção', 'Reparados']],
      body: [
        [
          assetMetrics.total.toString(),
          assetMetrics.inUse.toString(),
          assetMetrics.inMaintenance.toString(),
          assetMetrics.repaired.toString()
        ]
      ],
      headStyles: { fillColor: [15, 23, 42], halign: 'center' },
      bodyStyles: { halign: 'center', fontStyle: 'bold' }
    });

    const rows = filteredAssets.map(a => [
      a.name,
      a.category,
      a.quantity.toString(),
      a.status,
      a.condition,
      a.location,
      a.notes || a.serialNumber || '-'
    ]);

    autoTable(docPdf, {
      startY: (docPdf as any).lastAutoTable.finalY + 10,
      head: [['Equipamento / Bem', 'Categoria', 'Qtd', 'Estado', 'Condição', 'Local', 'Detalhes']],
      body: rows,
      headStyles: { fillColor: [184, 150, 87] },
      styles: { fontSize: 8 }
    });

    docPdf.save(`Patrimonio_Equipamentos_Igreja_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  // PDF Export for Cleaning Schedule
  const handleDownloadCleaningPDF = () => {
    const docPdf = new jsPDF();
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(20);
    docPdf.setTextColor(15, 23, 42);
    docPdf.text('Escala de Limpeza e Cuidados do Templo', pageWidth / 2, 20, { align: 'center' });

    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`"Zelo pela tua casa" • Relatório Oficial • ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

    const rows = filteredSchedules.map(s => [
      format(new Date(s.date + 'T00:00:00'), 'dd/MM/yyyy'),
      s.time,
      s.title,
      s.targetService,
      s.leaderName + (s.leaderPhone ? ` (${s.leaderPhone})` : ''),
      s.teamMembers.join(', ') || 'Equipe a definir',
      s.status
    ]);

    autoTable(docPdf, {
      startY: 35,
      head: [['Data', 'Hora', 'Ação / Grupo', 'Para o Culto', 'Líder Responsável', 'Equipe de Servos', 'Status']],
      body: rows,
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 }
    });

    docPdf.save(`Escala_Limpeza_Templo_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto px-2 sm:px-4">
      {/* Top Banner Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-church-gold/15 text-church-navy border border-church-gold/30 text-xs font-black uppercase tracking-wider mb-2">
            <Sparkles className="h-3.5 w-3.5 text-church-gold" />
            Zelo & Casa do Senhor
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-black text-church-navy">
            Manutenção, Limpeza & Patrimônio
          </h1>
          <p className="text-church-navy/70 text-sm sm:text-base mt-1">
            Gestão da escala de cuidados do templo e controle de inventário e equipamentos
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'cleaning' ? (
            <>
              <button
                onClick={handleDownloadCleaningPDF}
                className="flex items-center gap-2 rounded-xl border border-church-navy/15 bg-white px-4 py-3 text-xs sm:text-sm font-bold text-church-navy shadow-sm transition hover:bg-church-navy/5 active:scale-95"
              >
                <Download className="h-4 w-4" /> Baixar Escala em PDF
              </button>
              {canManage && (
                <button
                  onClick={() => handleOpenScheduleModal()}
                  className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Nova Escala de Limpeza
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={handleDownloadInventoryPDF}
                className="flex items-center gap-2 rounded-xl border border-church-navy/15 bg-white px-4 py-3 text-xs sm:text-sm font-bold text-church-navy shadow-sm transition hover:bg-church-navy/5 active:scale-95"
              >
                <Download className="h-4 w-4" /> Exportar Inventário PDF
              </button>
              {canManage && (
                <button
                  onClick={() => handleOpenAssetModal()}
                  className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Novo Equipamento / Bem
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-church-navy/10 gap-3">
        <button
          onClick={() => setActiveTab('cleaning')}
          className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'cleaning'
              ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
              : 'border-transparent text-church-navy/60 hover:text-church-navy'
          }`}
        >
          <Sparkles className="h-4 w-4 text-church-gold" />
          <span>Escala de Limpeza & Cuidados</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
            {schedules.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'inventory'
              ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
              : 'border-transparent text-church-navy/60 hover:text-church-navy'
          }`}
        >
          <Wrench className="h-4 w-4 text-church-gold" />
          <span>Inventário & Controle de Equipamentos</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
            {assets.length}
          </span>
        </button>
      </div>

      {/* TAB 1: ESCALA DE LIMPEZA E CUIDADOS */}
      {activeTab === 'cleaning' && (
        <div className="space-y-6">
          {/* Quick Notice Card */}
          <div className="rounded-2xl bg-gradient-to-r from-church-navy to-church-navy/90 p-5 sm:p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-bold text-church-gold flex items-center gap-2">
                <Sparkles className="h-5 w-5" /> Ministério de Zeladoria & Cuidados do Templo
              </h2>
              <p className="text-white/80 text-xs sm:text-sm max-w-2xl leading-relaxed">
                "Pois um dia nos teus átrios vale mais que mil em qualquer outro lugar; prefiro estar à porta da casa do meu Deus..." (Salmos 84:10). Marque as tarefas executadas em tempo real!
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 text-white font-medium">
                {schedules.filter(s => s.status === 'Concluída').length} Concluídas
              </span>
              <span className="text-xs bg-church-gold/20 text-church-gold px-3 py-1.5 rounded-xl border border-church-gold/30 font-bold">
                {schedules.filter(s => s.status === 'Agendada' || s.status === 'Em andamento').length} Em Aberto
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-church-navy/10 shadow-sm">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {['Todos', 'Agendada', 'Em andamento', 'Concluída'].map(status => (
                <button
                  key={status}
                  onClick={() => setScheduleStatusFilter(status)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                    scheduleStatusFilter === status
                      ? 'bg-church-navy text-white shadow-sm'
                      : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Schedules List */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <RefreshCw className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando escalas de limpeza...</p>
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <Sparkles className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhuma escala de limpeza encontrada</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Crie os grupos de limpeza e atribua os irmãos responsáveis para deixar a casa do Senhor pronta antes de cada culto.
              </p>
              {canManage && (
                <button
                  onClick={() => handleOpenScheduleModal()}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Criar Primeira Escala
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredSchedules.map(schedule => {
                const totalTasks = schedule.checklist?.length || 0;
                const completedTasks = schedule.checklist?.filter(i => i.completed).length || 0;
                const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                return (
                  <motion.div
                    key={schedule.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-3xl bg-white p-5 sm:p-6 border border-church-navy/10 shadow-sm hover:shadow-md transition space-y-4 relative flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-church-gold/15 text-church-navy border border-church-gold/20 flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-church-gold" />
                              {format(new Date(schedule.date + 'T00:00:00'), 'dd/MM/yyyy (EEE)', { locale: ptBR })}
                            </span>
                            <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-church-navy/5 text-church-navy flex items-center gap-1">
                              <Clock className="h-3 w-3 text-church-navy/60" />
                              {schedule.time}
                            </span>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                              schedule.status === 'Concluída' 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                                : schedule.status === 'Em andamento'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}>
                              {schedule.status}
                            </span>
                          </div>
                          <h3 className="font-serif text-lg font-bold text-church-navy">
                            {schedule.title}
                          </h3>
                          <p className="text-xs font-medium text-church-navy/60 flex items-center gap-1 mt-0.5">
                            <CheckCircle2 className="h-3 w-3 text-church-gold" />
                            Preparação para: <span className="text-church-navy font-bold">{schedule.targetService}</span>
                          </p>
                        </div>

                        {canManage && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleOpenScheduleModal(schedule)}
                              className="p-1.5 rounded-lg text-church-navy/60 hover:text-church-navy hover:bg-church-navy/5"
                              title="Editar Escala"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteItem({ id: schedule.id, type: 'schedule', name: schedule.title })}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                              title="Excluir Escala"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Team & Leader */}
                      <div className="bg-church-navy/[0.02] p-3.5 rounded-2xl border border-church-navy/5 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-church-navy/60 font-medium">Líder / Responsável:</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-church-navy">{schedule.leaderName}</span>
                            {schedule.leaderPhone && (
                              <a
                                href={`https://wa.me/55${schedule.leaderPhone.replace(/\D/g, '')}?text=Olá%20irmão,%20sobre%20a%20escala%20de%20limpeza%20da%20igreja`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold text-[10px] flex items-center gap-1"
                              >
                                <Phone className="h-2.5 w-2.5" /> WhatsApp
                              </a>
                            )}
                          </div>
                        </div>

                        {schedule.teamMembers && schedule.teamMembers.length > 0 && (
                          <div className="flex items-start justify-between text-xs pt-1 border-t border-church-navy/5">
                            <span className="text-church-navy/60 font-medium shrink-0 mr-2">Equipe de Servos:</span>
                            <div className="flex flex-wrap gap-1 justify-end">
                              {schedule.teamMembers.map((m, idx) => (
                                <span key={idx} className="bg-white border border-church-navy/10 px-2 py-0.5 rounded-md text-[11px] font-medium text-church-navy">
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Progress Bar */}
                      {totalTasks > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-church-navy flex items-center gap-1.5">
                              <CheckSquare className="h-3.5 w-3.5 text-church-gold" />
                              Checklist de Cuidados ({completedTasks}/{totalTasks})
                            </span>
                            <span className="font-bold text-church-navy/70 text-[11px]">{progressPct}%</span>
                          </div>
                          <div className="h-2 w-full bg-church-navy/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-church-gold to-emerald-500 transition-all duration-300"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Interactive Checklist Tasks */}
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {schedule.checklist && schedule.checklist.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleToggleTask(schedule, item.id)}
                            className={`w-full flex items-center justify-between text-left p-2 rounded-xl border text-xs transition active:scale-[0.99] ${
                              item.completed
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                : 'bg-white border-church-navy/10 text-church-navy hover:bg-church-navy/[0.02]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              {item.completed ? (
                                <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                              ) : (
                                <Square className="h-4 w-4 text-church-navy/30 shrink-0" />
                              )}
                              <span className={item.completed ? 'line-through text-emerald-800/70' : 'font-medium'}>
                                {item.task}
                              </span>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-church-navy/5 text-church-navy/60 font-semibold shrink-0">
                              {item.area}
                            </span>
                          </button>
                        ))}
                      </div>

                      {schedule.observations && (
                        <p className="text-xs italic text-church-navy/60 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/50">
                          <strong>Nota:</strong> {schedule.observations}
                        </p>
                      )}
                    </div>

                    {/* Bottom Status Buttons */}
                    <div className="pt-3 border-t border-church-navy/5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-church-navy/50">
                        {schedule.status === 'Concluída' && schedule.completedAt ? (
                          `Finalizada em ${format(new Date(schedule.completedAt), 'dd/MM HH:mm')}`
                        ) : (
                          'Toque em cada item para marcar como feito'
                        )}
                      </span>

                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          {schedule.status !== 'Concluída' ? (
                            <button
                              onClick={() => handleUpdateScheduleStatus(schedule.id, 'Concluída')}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm transition"
                            >
                              <Check className="h-3.5 w-3.5" /> Concluir Tudo
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpdateScheduleStatus(schedule.id, 'Agendada')}
                              className="px-2.5 py-1 text-church-navy/60 hover:text-church-navy text-xs font-medium"
                            >
                              Reabrir
                            </button>
                          )}
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

      {/* TAB 2: INVENTÁRIO E CONTROLE DE EQUIPAMENTOS */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* Metrics Counter Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-church-navy/60 uppercase tracking-wider block">Total de Ativos</span>
              <p className="text-2xl sm:text-3xl font-black text-church-navy mt-1">{assetMetrics.total}</p>
              <span className="text-[11px] text-church-navy/50">{assetMetrics.totalDistinct} modelos cadastrados</span>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">Em Uso Ativo</span>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1">{assetMetrics.inUse}</p>
              <span className="text-[11px] text-emerald-700/70">Disponíveis no templo</span>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wider block">Em Manutenção</span>
              <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-1">{assetMetrics.inMaintenance}</p>
              <span className="text-[11px] text-amber-700/70">Necessita de reparo</span>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">Reparados</span>
              <p className="text-2xl sm:text-3xl font-black text-blue-600 mt-1">{assetMetrics.repaired}</p>
              <span className="text-[11px] text-blue-700/70">Prontos p/ uso</span>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-white p-4 rounded-3xl border border-church-navy/10 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-church-navy/40" />
                <input
                  type="text"
                  placeholder="Buscar por nome, modelo, número de série ou local..."
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-church-navy/15 text-sm focus:border-church-gold focus:outline-none bg-church-navy/[0.02]"
                />
              </div>

              {/* Status Pill Selector */}
              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                {['Todos', 'Em uso', 'Em manutenção', 'Reparado', 'Reserva / Almoxarifado'].map(st => (
                  <button
                    key={st}
                    onClick={() => setAssetStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                      assetStatusFilter === st
                        ? 'bg-church-navy text-white'
                        : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Category horizontal pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-church-navy/5 pb-1">
              <span className="text-xs font-bold text-church-navy/60 mr-1 shrink-0 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Categorias:
              </span>
              {ASSET_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setAssetCategoryFilter(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    assetCategoryFilter === cat
                      ? 'bg-church-gold text-white font-bold'
                      : 'bg-church-navy/[0.03] text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Asset List Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <RefreshCw className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando patrimônio da igreja...</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <Wrench className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhum equipamento encontrado</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Cadastre os microfones, cabos, instrumentos, ares-condicionados e projetores para controle de manutenção e zeladoria.
              </p>
              {canManage && (
                <button
                  onClick={() => handleOpenAssetModal()}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Cadastrar Primeiro Equipamento
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAssets.map(asset => {
                // Category icon helper
                const getCategoryIcon = () => {
                  switch (asset.category) {
                    case 'Microfones': return <Mic className="h-4 w-4 text-church-gold" />;
                    case 'Cabos & Conectores': return <Zap className="h-4 w-4 text-church-gold" />;
                    case 'Instrumentos Musicais': return <Disc className="h-4 w-4 text-church-gold" />;
                    case 'Som & Áudio': return <Volume2 className="h-4 w-4 text-church-gold" />;
                    case 'Projetores & Telões': return <Tv className="h-4 w-4 text-church-gold" />;
                    case 'Ar Condicionado & Ventilação': return <Wind className="h-4 w-4 text-church-gold" />;
                    default: return <Wrench className="h-4 w-4 text-church-gold" />;
                  }
                };

                return (
                  <motion.div
                    key={asset.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-3xl bg-white p-5 border border-church-navy/10 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      {/* Top tags */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-church-navy/5 text-church-navy flex items-center gap-1.5">
                          {getCategoryIcon()}
                          {asset.category}
                        </span>

                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                          asset.status === 'Em uso'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : asset.status === 'Em manutenção'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse'
                            : asset.status === 'Reparado'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-zinc-100 text-zinc-800 border border-zinc-200'
                        }`}>
                          {asset.status}
                        </span>
                      </div>

                      {/* Title & Quantity */}
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="font-serif text-lg font-bold text-church-navy line-clamp-1">
                            {asset.name}
                          </h4>
                          <span className="text-xs font-black px-2 py-0.5 rounded-full bg-church-gold/20 text-church-navy shrink-0">
                            Qtd: {asset.quantity}
                          </span>
                        </div>

                        <p className="text-xs text-church-navy/60 flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3 text-church-gold" />
                          Local: <span className="text-church-navy font-semibold">{asset.location || 'Templo Sede'}</span>
                        </p>
                      </div>

                      {/* Condition badge & details */}
                      <div className="bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-church-navy/60">Condição Física:</span>
                          <span className={`font-bold ${
                            asset.condition === 'Novo' || asset.condition === 'Bom'
                              ? 'text-emerald-700'
                              : asset.condition === 'Regular'
                              ? 'text-amber-700'
                              : 'text-red-600'
                          }`}>
                            {asset.condition}
                          </span>
                        </div>

                        {asset.serialNumber && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-church-navy/50">Nº de Série / Tag:</span>
                            <span className="font-mono text-church-navy font-semibold">{asset.serialNumber}</span>
                          </div>
                        )}

                        {asset.notes && (
                          <p className="text-[11px] text-church-navy/70 italic pt-1 border-t border-church-navy/5">
                            "{asset.notes}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-church-navy/5 flex items-center justify-between text-xs">
                      <span className="text-[10px] text-church-navy/40">
                        {asset.lastInventoryDate ? `Inv: ${format(new Date(asset.lastInventoryDate + 'T00:00:00'), 'dd/MM/yyyy')}` : ''}
                      </span>

                      {canManage && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenAssetModal(asset)}
                            className="p-1.5 rounded-lg text-church-navy/70 hover:text-church-navy hover:bg-church-navy/5 transition"
                            title="Editar Ativo"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteItem({ id: asset.id, type: 'asset', name: asset.name })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                            title="Remover Ativo"
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

      {/* MODAL: NOVO / EDITAR ATIVO */}
      <AnimatePresence>
        {isAssetModalOpen && (
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
                    {editingAsset ? 'Editar Equipamento / Bem' : 'Novo Equipamento / Bem'}
                  </h3>
                  <p className="text-xs text-church-navy/60">Controle de patrimônio e manutenção</p>
                </div>
                <button
                  onClick={() => setIsAssetModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveAsset} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Nome do Equipamento *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Microfone Sem Fio Shure BLX24, Cabo XLR 10m, Ar Condicionado Split 24000..."
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Categoria
                    </label>
                    <select
                      value={assetForm.category}
                      onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      {ASSET_CATEGORIES.filter(c => c !== 'Todos').map(c => (
                        <option key={c} value={c}>{c}</option>
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
                      value={assetForm.quantity}
                      onChange={(e) => setAssetForm({ ...assetForm, quantity: parseInt(e.target.value) || 1 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                    </input>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Status de Uso *
                    </label>
                    <select
                      value={assetForm.status}
                      onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none font-medium"
                    >
                      <option value="Em uso">Em uso</option>
                      <option value="Em manutenção">Em manutenção</option>
                      <option value="Reparado">Reparado</option>
                      <option value="Reserva / Almoxarifado">Reserva / Almoxarifado</option>
                      <option value="Baixado">Baixado / Inativo</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Condição Física
                    </label>
                    <select
                      value={assetForm.condition}
                      onChange={(e) => setAssetForm({ ...assetForm, condition: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      <option value="Novo">Novo</option>
                      <option value="Bom">Bom</option>
                      <option value="Regular">Regular</option>
                      <option value="Precisa de Manutenção">Precisa de Manutenção</option>
                      <option value="Danificado">Danificado</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Localização
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Altar, Cabine de Som, Sala Kids, Almoxarifado..."
                      value={assetForm.location}
                      onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Nº de Série / Patrimônio
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: SN-948271 ou TAG-04"
                      value={assetForm.serialNumber}
                      onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Observações / Histórico de Manutenção
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ex: Cabo com pequeno ruído no conector; precisa soldar terminal XLR..."
                    value={assetForm.notes}
                    onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsAssetModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    {editingAsset ? 'Atualizar Ativo' : 'Salvar Ativo'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: NOVA / EDITAR ESCALA DE LIMPEZA */}
      <AnimatePresence>
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-church-navy/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-church-gold/20"
            >
              <div className="flex items-center justify-between pb-4 border-b border-church-navy/10 mb-6">
                <div>
                  <h3 className="font-serif text-xl font-bold text-church-navy">
                    {editingSchedule ? 'Editar Escala de Limpeza' : 'Nova Escala de Limpeza & Cuidados'}
                  </h3>
                  <p className="text-xs text-church-navy/60">Organize os servos e as áreas de preparação do templo</p>
                </div>
                <button
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveSchedule} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Título da Escala *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Limpeza e Organização para o Culto de Domingo"
                    value={scheduleForm.title}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Data *
                    </label>
                    <input
                      type="date"
                      required
                      value={scheduleForm.date}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Horário
                    </label>
                    <input
                      type="time"
                      value={scheduleForm.time}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Para o Culto / Evento
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Domingo 18h"
                      value={scheduleForm.targetService}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, targetService: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Líder / Responsável *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Nome do irmão responsável"
                      value={scheduleForm.leaderName}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, leaderName: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />

                    {/* Quick suggestion button */}
                    {membersList.length > 0 && !scheduleForm.leaderName && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="text-[10px] text-church-navy/50 mr-1">Sugestão:</span>
                        {membersList.slice(0, 3).map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setScheduleForm({ ...scheduleForm, leaderName: m.name, leaderPhone: m.phone || '' })}
                            className="text-[10px] bg-church-navy/5 hover:bg-church-navy/10 px-2 py-0.5 rounded text-church-navy font-medium"
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      WhatsApp do Líder
                    </label>
                    <input
                      type="tel"
                      placeholder="(99) 99999-9999"
                      value={scheduleForm.leaderPhone}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, leaderPhone: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Equipe de Servos (separados por vírgula)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Diác. Marcos, Ir. Maria, Jovem Lucas, Ir. Ana"
                    value={scheduleForm.teamMembersInput}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, teamMembersInput: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-2">
                    Áreas para Cuidados / Limpeza (Gerar Checklist)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/10">
                    {DEFAULT_CLEANING_AREAS.map(area => {
                      const isSelected = scheduleForm.selectedAreas.includes(area);
                      return (
                        <button
                          key={area}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setScheduleForm({
                                ...scheduleForm,
                                selectedAreas: scheduleForm.selectedAreas.filter(a => a !== area)
                              });
                            } else {
                              setScheduleForm({
                                ...scheduleForm,
                                selectedAreas: [...scheduleForm.selectedAreas, area]
                              });
                            }
                          }}
                          className={`flex items-center gap-2 p-2 rounded-xl text-xs font-medium text-left transition ${
                            isSelected
                              ? 'bg-church-navy text-white shadow-sm'
                              : 'bg-white border border-church-navy/10 text-church-navy hover:bg-church-navy/5'
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-church-gold shrink-0" />
                          ) : (
                            <Square className="h-4 w-4 text-church-navy/40 shrink-0" />
                          )}
                          <span className="line-clamp-1">{area}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Instruções Especiais / Materiais Necessários
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ex: Verificar bebedouro e repor sacos de 50L nos banheiros..."
                    value={scheduleForm.observations}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, observations: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsScheduleModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    {editingSchedule ? 'Atualizar Escala' : 'Criar Escala de Limpeza'}
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
        title={deleteItem?.type === 'asset' ? 'Excluir Equipamento' : 'Excluir Escala de Limpeza'}
        message={`Tem certeza que deseja remover "${deleteItem?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={confirmDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
