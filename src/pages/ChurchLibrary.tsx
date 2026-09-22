import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Plus, Search, Filter, Calendar, Clock, User, Phone, 
  CheckCircle2, AlertCircle, AlertTriangle, ArrowRightLeft, BookMarked, 
  Library, Trash2, Edit3, X, Download, Shield, RefreshCw, ChevronRight,
  Sparkles, Check, BookmarkCheck
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, 
  deleteDoc, doc, serverTimestamp, getDocs 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays, isPast, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuthState } from 'react-firebase-hooks/auth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  category: 'Teologia & Doutrina' | 'Comentários Bíblicos' | 'Vida Cristã & Discipulado' | 'Família & Casamento' | 'Jovens & Adolescentes' | 'Infantil' | 'Liderança & Ministério' | 'Devocionais & Oração' | 'História da Igreja' | 'Outros';
  isbn?: string;
  publisher?: string;
  edition?: string;
  totalCopies: number;
  availableCopies: number;
  locationShelf?: string;
  coverUrl?: string;
  description?: string;
  status: 'Disponível' | 'Emprestado' | 'Em Manutenção / Danificado' | 'Extraviado';
  createdAt?: any;
}

export interface BookLoan {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  memberId?: string;
  memberName: string;
  memberPhone?: string;
  loanDate: string; // YYYY-MM-DD
  expectedReturnDate: string; // YYYY-MM-DD
  actualReturnDate?: string;
  status: 'Ativo' | 'Devolvido' | 'Atrasado' | 'Renovado';
  notes?: string;
  registeredById?: string;
  registeredByName?: string;
  createdAt?: any;
}

const BOOK_CATEGORIES = [
  'Todos',
  'Teologia & Doutrina',
  'Comentários Bíblicos',
  'Vida Cristã & Discipulado',
  'Família & Casamento',
  'Jovens & Adolescentes',
  'Infantil',
  'Liderança & Ministério',
  'Devocionais & Oração',
  'História da Igreja',
  'Outros'
];

interface ChurchLibraryProps {
  role?: string | null;
}

export default function ChurchLibrary({ role }: ChurchLibraryProps) {
  const [user] = useAuthState(auth);
  const [activeTab, setActiveTab] = useState<'catalog' | 'loans'>('catalog');

  // Data States
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loans, setLoans] = useState<BookLoan[]>([]);
  const [membersList, setMembersList] = useState<{ id: string; name: string; phone?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [availabilityFilter, setAvailabilityFilter] = useState<'Todos' | 'Disponíveis' | 'Emprestados'>('Todos');
  const [loanStatusFilter, setLoanStatusFilter] = useState('Todos');
  const [loanSearch, setLoanSearch] = useState('');

  // Modals
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<LibraryBook | null>(null);
  const [preselectedBookForLoan, setPreselectedBookForLoan] = useState<LibraryBook | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ id: string; type: 'book' | 'loan'; name: string } | null>(null);

  // Permissions: Admin, Pastor, Pastora, Obreiros, Líderes, Secretária
  const canManage = useMemo(() => {
    if (!user) return false;
    if (user.email?.toLowerCase() === 'kevinnaranjo1@gmail.com') return true;
    if (!role) return false;
    const r = role.toLowerCase();
    return ['admin', 'pastor', 'pastora', 'leader', 'obreiro', 'presbítero', 'missionário', 'missionária', 'diácono', 'evangelista', 'diaconisa', 'secretária'].includes(r);
  }, [role, user]);

  // Book Form State
  const [bookForm, setBookForm] = useState({
    title: '',
    author: '',
    category: 'Comentários Bíblicos' as LibraryBook['category'],
    totalCopies: 1,
    availableCopies: 1,
    locationShelf: 'Estante 1 - Prateleira A',
    publisher: '',
    edition: '',
    isbn: '',
    coverUrl: '',
    description: '',
    status: 'Disponível' as LibraryBook['status']
  });

  // Loan Form State
  const [loanForm, setLoanForm] = useState({
    bookId: '',
    bookTitle: '',
    bookAuthor: '',
    memberName: '',
    memberPhone: '',
    loanDate: format(new Date(), 'yyyy-MM-dd'),
    expectedReturnDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'), // 14 days standard loan
    notes: ''
  });

  // Real-time Firestore subscriptions
  useEffect(() => {
    const qBooks = query(collection(db, 'library_books'), orderBy('title', 'asc'));
    const unsubBooks = onSnapshot(qBooks, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as LibraryBook[];
      setBooks(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'library_books');
    });

    const qLoans = query(collection(db, 'book_loans'), orderBy('loanDate', 'desc'));
    const unsubLoans = onSnapshot(qLoans, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const item = { id: doc.id, ...doc.data() } as BookLoan;
        // Auto-flag overdue loans
        if (item.status === 'Ativo' && item.expectedReturnDate && isPast(new Date(item.expectedReturnDate + 'T23:59:59'))) {
          item.status = 'Atrasado';
        }
        return item;
      });
      setLoans(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'book_loans');
      setLoading(false);
    });

    const qMembers = query(collection(db, 'members'), orderBy('name', 'asc'));
    const unsubMembers = onSnapshot(qMembers, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || '',
        phone: doc.data().whatsapp || doc.data().phone || ''
      }));
      setMembersList(list);
    });

    return () => {
      unsubBooks();
      unsubLoans();
      unsubMembers();
    };
  }, []);

  // Filtered Books
  const filteredBooks = useMemo(() => {
    return books.filter(b => {
      const matchCat = selectedCategory === 'Todos' || b.category === selectedCategory;
      const matchSearch = !catalogSearch || 
        b.title.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        b.author.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        b.publisher?.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        b.locationShelf?.toLowerCase().includes(catalogSearch.toLowerCase());
      
      const matchAvail = availabilityFilter === 'Todos' 
        ? true 
        : availabilityFilter === 'Disponíveis'
        ? (b.availableCopies > 0 && b.status === 'Disponível')
        : (b.availableCopies === 0 || b.status === 'Emprestado');

      return matchCat && matchSearch && matchAvail;
    });
  }, [books, selectedCategory, catalogSearch, availabilityFilter]);

  // Filtered Loans
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const matchStatus = loanStatusFilter === 'Todos' || l.status === loanStatusFilter;
      const matchSearch = !loanSearch ||
        l.bookTitle.toLowerCase().includes(loanSearch.toLowerCase()) ||
        l.memberName.toLowerCase().includes(loanSearch.toLowerCase()) ||
        l.bookAuthor.toLowerCase().includes(loanSearch.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [loans, loanStatusFilter, loanSearch]);

  // Metrics
  const libraryMetrics = useMemo(() => {
    const totalTitles = books.length;
    const totalPhysicalCopies = books.reduce((acc, curr) => acc + (curr.totalCopies || 1), 0);
    const availablePhysicalCopies = books.reduce((acc, curr) => acc + (curr.availableCopies ?? curr.totalCopies ?? 1), 0);
    const activeLoansCount = loans.filter(l => l.status === 'Ativo' || l.status === 'Atrasado' || l.status === 'Renovado').length;
    const overdueLoansCount = loans.filter(l => l.status === 'Atrasado').length;

    return {
      totalTitles,
      totalPhysicalCopies,
      availablePhysicalCopies,
      activeLoansCount,
      overdueLoansCount
    };
  }, [books, loans]);

  // Book Modal Open
  const handleOpenBookModal = (book?: LibraryBook) => {
    if (book) {
      setEditingBook(book);
      setBookForm({
        title: book.title,
        author: book.author,
        category: book.category || 'Comentários Bíblicos',
        totalCopies: book.totalCopies || 1,
        availableCopies: book.availableCopies ?? book.totalCopies ?? 1,
        locationShelf: book.locationShelf || '',
        publisher: book.publisher || '',
        edition: book.edition || '',
        isbn: book.isbn || '',
        coverUrl: book.coverUrl || '',
        description: book.description || '',
        status: book.status || 'Disponível'
      });
    } else {
      setEditingBook(null);
      setBookForm({
        title: '',
        author: '',
        category: 'Comentários Bíblicos',
        totalCopies: 1,
        availableCopies: 1,
        locationShelf: 'Estante 1 - Prateleira A',
        publisher: '',
        edition: '',
        isbn: '',
        coverUrl: '',
        description: '',
        status: 'Disponível'
      });
    }
    setIsBookModalOpen(true);
  };

  // Save Book
  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    try {
      const avail = Math.min(bookForm.availableCopies, bookForm.totalCopies);
      const computedStatus: LibraryBook['status'] = avail <= 0 ? 'Emprestado' : bookForm.status;

      if (editingBook) {
        await updateDoc(doc(db, 'library_books', editingBook.id), {
          ...bookForm,
          availableCopies: avail,
          status: computedStatus,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'library_books'), {
          ...bookForm,
          availableCopies: avail,
          status: computedStatus,
          createdAt: serverTimestamp()
        });
      }
      setIsBookModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'library_books');
    }
  };

  // Loan Modal Open
  const handleOpenLoanModal = (book?: LibraryBook) => {
    const selected = book || books.find(b => b.availableCopies > 0) || books[0];
    setPreselectedBookForLoan(selected || null);

    setLoanForm({
      bookId: selected?.id || '',
      bookTitle: selected?.title || '',
      bookAuthor: selected?.author || '',
      memberName: '',
      memberPhone: '',
      loanDate: format(new Date(), 'yyyy-MM-dd'),
      expectedReturnDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
      notes: ''
    });
    setIsLoanModalOpen(true);
  };

  // Save Loan
  const handleSaveLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    try {
      const targetBook = books.find(b => b.id === loanForm.bookId);
      if (!targetBook) return;

      // Register loan
      await addDoc(collection(db, 'book_loans'), {
        bookId: loanForm.bookId,
        bookTitle: targetBook.title,
        bookAuthor: targetBook.author,
        memberName: loanForm.memberName,
        memberPhone: loanForm.memberPhone,
        loanDate: loanForm.loanDate,
        expectedReturnDate: loanForm.expectedReturnDate,
        status: 'Ativo',
        notes: loanForm.notes,
        registeredById: user?.uid || '',
        registeredByName: user?.displayName || user?.email || 'Bibliotecário',
        createdAt: serverTimestamp()
      });

      // Decrement available copies in book
      const newAvail = Math.max(0, (targetBook.availableCopies || 1) - 1);
      await updateDoc(doc(db, 'library_books', targetBook.id), {
        availableCopies: newAvail,
        status: newAvail === 0 ? 'Emprestado' : 'Disponível'
      });

      setIsLoanModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'book_loans');
    }
  };

  // Return Book Action
  const handleReturnBook = async (loan: BookLoan) => {
    if (!canManage) return;
    try {
      // Mark loan returned
      await updateDoc(doc(db, 'book_loans', loan.id), {
        status: 'Devolvido',
        actualReturnDate: format(new Date(), 'yyyy-MM-dd'),
        updatedAt: serverTimestamp()
      });

      // Increment available copy
      const targetBook = books.find(b => b.id === loan.bookId);
      if (targetBook) {
        const newAvail = Math.min(targetBook.totalCopies, (targetBook.availableCopies || 0) + 1);
        await updateDoc(doc(db, 'library_books', targetBook.id), {
          availableCopies: newAvail,
          status: 'Disponível'
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `book_loans/${loan.id}`);
    }
  };

  // Renew Loan (+14 days)
  const handleRenewLoan = async (loan: BookLoan) => {
    if (!canManage) return;
    try {
      const currentExpected = loan.expectedReturnDate ? new Date(loan.expectedReturnDate + 'T00:00:00') : new Date();
      const newDate = format(addDays(currentExpected, 14), 'yyyy-MM-dd');

      await updateDoc(doc(db, 'book_loans', loan.id), {
        expectedReturnDate: newDate,
        status: 'Renovado',
        notes: `${loan.notes ? loan.notes + ' • ' : ''}Renovado em ${format(new Date(), 'dd/MM/yyyy')}`
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `book_loans/${loan.id}`);
    }
  };

  // Delete Action
  const confirmDelete = async () => {
    if (!deleteItem || !canManage) return;
    try {
      const col = deleteItem.type === 'book' ? 'library_books' : 'book_loans';
      await deleteDoc(doc(db, col, deleteItem.id));
      setDeleteItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${deleteItem.type}/${deleteItem.id}`);
    }
  };

  // PDF Export for Library Catalog
  const handleDownloadCatalogPDF = () => {
    const docPdf = new jsPDF();
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(20);
    docPdf.setTextColor(15, 23, 42); // church-navy
    docPdf.text('Biblioteca da Igreja - Catálogo de Livros', pageWidth / 2, 20, { align: 'center' });

    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`Igreja Evangélica Assembleia de Deus • Emissão: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

    autoTable(docPdf, {
      startY: 35,
      head: [['Título da Obra', 'Autor', 'Categoria', 'Exemplares', 'Disponíveis', 'Estante / Local']],
      body: filteredBooks.map(b => [
        b.title,
        b.author,
        b.category,
        b.totalCopies.toString(),
        (b.availableCopies ?? b.totalCopies).toString(),
        b.locationShelf || 'Geral'
      ]),
      headStyles: { fillColor: [15, 23, 42] },
      styles: { fontSize: 8 }
    });

    docPdf.save(`Catalogo_Biblioteca_Igreja_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  // PDF Export for Loans History
  const handleDownloadLoansPDF = () => {
    const docPdf = new jsPDF();
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(20);
    docPdf.setTextColor(15, 23, 42);
    docPdf.text('Relatório de Empréstimos de Livros', pageWidth / 2, 20, { align: 'center' });

    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`Controle de Leitura & Edificação • ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

    autoTable(docPdf, {
      startY: 35,
      head: [['Livro', 'Membro / Leitor', 'Contato', 'Empréstimo', 'Devolução Prev.', 'Status']],
      body: filteredLoans.map(l => [
        l.bookTitle,
        l.memberName,
        l.memberPhone || '-',
        format(new Date(l.loanDate + 'T00:00:00'), 'dd/MM/yyyy'),
        format(new Date(l.expectedReturnDate + 'T00:00:00'), 'dd/MM/yyyy'),
        l.status
      ]),
      headStyles: { fillColor: [184, 150, 87] }, // church-gold
      styles: { fontSize: 8 }
    });

    docPdf.save(`Relatorio_Emprestimos_Livros_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto px-2 sm:px-4">
      {/* Top Banner Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-church-gold/15 text-church-navy border border-church-gold/30 text-xs font-black uppercase tracking-wider mb-2">
            <BookOpen className="h-3.5 w-3.5 text-church-gold" />
            Edificação & Ensino da Palavra
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-black text-church-navy">
            Biblioteca da Igreja & Préstamo de Libros
          </h1>
          <p className="text-church-navy/70 text-sm sm:text-base mt-1">
            Catálogo de livros cristãos, comentários bíblicos e registro de empréstimos
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'catalog' ? (
            <>
              <button
                onClick={handleDownloadCatalogPDF}
                className="flex items-center gap-2 rounded-xl border border-church-navy/15 bg-white px-4 py-3 text-xs sm:text-sm font-bold text-church-navy shadow-sm transition hover:bg-church-navy/5 active:scale-95"
              >
                <Download className="h-4 w-4" /> Baixar Catálogo PDF
              </button>
              {canManage && (
                <button
                  onClick={() => handleOpenBookModal()}
                  className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Cadastrar Novo Livro
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={handleDownloadLoansPDF}
                className="flex items-center gap-2 rounded-xl border border-church-navy/15 bg-white px-4 py-3 text-xs sm:text-sm font-bold text-church-navy shadow-sm transition hover:bg-church-navy/5 active:scale-95"
              >
                <Download className="h-4 w-4" /> Relatório de Empréstimos PDF
              </button>
              {canManage && (
                <button
                  onClick={() => handleOpenLoanModal()}
                  className="flex items-center gap-2 rounded-xl bg-church-navy px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-church-navy/20 transition hover:bg-church-navy/90 active:scale-95"
                >
                  <ArrowRightLeft className="h-4 w-4 text-church-gold" /> Registrar Empréstimo
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-church-navy/60 uppercase tracking-wider block">Títulos Disponíveis</span>
          <p className="text-2xl sm:text-3xl font-black text-church-navy mt-1">{libraryMetrics.totalTitles}</p>
          <span className="text-[11px] text-church-navy/50">{libraryMetrics.totalPhysicalCopies} cópias físicas no acervo</span>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">Prontos p/ Retirada</span>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1">{libraryMetrics.availablePhysicalCopies}</p>
          <span className="text-[11px] text-emerald-700/70">Exemplares nas prateleiras</span>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">Empréstimos Ativos</span>
          <p className="text-2xl sm:text-3xl font-black text-blue-600 mt-1">{libraryMetrics.activeLoansCount}</p>
          <span className="text-[11px] text-blue-700/70">Com membros em leitura</span>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-church-navy/10 shadow-sm">
          <span className="text-xs font-bold text-amber-700 uppercase tracking-wider block">Atrasados / Pendentes</span>
          <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-1">{libraryMetrics.overdueLoansCount}</p>
          <span className="text-[11px] text-amber-700/70">Necessitam lembrete</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-church-navy/10 gap-3">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'catalog'
              ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
              : 'border-transparent text-church-navy/60 hover:text-church-navy'
          }`}
        >
          <Library className="h-4 w-4 text-church-gold" />
          <span>Catálogo de Livros Cristãos</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
            {books.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('loans')}
          className={`flex items-center gap-2 px-5 py-3.5 font-bold text-sm border-b-2 transition-all ${
            activeTab === 'loans'
              ? 'border-church-gold text-church-navy bg-church-gold/10 rounded-t-xl'
              : 'border-transparent text-church-navy/60 hover:text-church-navy'
          }`}
        >
          <ArrowRightLeft className="h-4 w-4 text-church-gold" />
          <span>Controle de Empréstimos & Devoluções</span>
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-black bg-church-navy/10 text-church-navy">
            {loans.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CATÁLOGO DE LIVROS */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          {/* Search & Filter Bar */}
          <div className="bg-white p-4 rounded-3xl border border-church-navy/10 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative w-full sm:flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-church-navy/40" />
                <input
                  type="text"
                  placeholder="Buscar por título, autor, editora ou estante..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-church-navy/15 text-sm focus:border-church-gold focus:outline-none bg-church-navy/[0.02]"
                />
              </div>

              {/* Availability Filter */}
              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
                {(['Todos', 'Disponíveis', 'Emprestados'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAvailabilityFilter(f)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                      availabilityFilter === f
                        ? 'bg-church-navy text-white shadow-sm'
                        : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Category horizontal pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-church-navy/5 pb-1">
              <span className="text-xs font-bold text-church-navy/60 mr-1 shrink-0 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Seção:
              </span>
              {BOOK_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    selectedCategory === cat
                      ? 'bg-church-gold text-white font-bold'
                      : 'bg-church-navy/[0.03] text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Books List Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <RefreshCw className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando acervo da biblioteca...</p>
            </div>
          ) : filteredBooks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <BookOpen className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhum livro encontrado</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Cadastre os livros, bíblias de estudo e comentários teológicos para disponibilizar aos irmãos da congregação.
              </p>
              {canManage && (
                <button
                  onClick={() => handleOpenBookModal()}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
                >
                  <Plus className="h-4 w-4 text-church-gold" /> Cadastrar Primeiro Livro
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBooks.map(book => {
                const isAvailable = (book.availableCopies ?? book.totalCopies) > 0;

                return (
                  <motion.div
                    key={book.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-3xl bg-white p-5 border border-church-navy/10 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      {/* Top category & Status */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-church-navy/5 text-church-navy flex items-center gap-1.5">
                          <BookmarkCheck className="h-3.5 w-3.5 text-church-gold" />
                          {book.category}
                        </span>

                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                          isAvailable
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}>
                          {isAvailable ? `${book.availableCopies} Disp.` : 'Emprestado'}
                        </span>
                      </div>

                      {/* Title & Author */}
                      <div>
                        <h4 className="font-serif text-lg font-bold text-church-navy leading-snug line-clamp-2">
                          {book.title}
                        </h4>
                        <p className="text-xs font-bold text-church-gold mt-1">
                          por {book.author}
                        </p>
                      </div>

                      {/* Location & Details Card */}
                      <div className="bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-church-navy/60">Localização / Estante:</span>
                          <span className="font-bold text-church-navy">{book.locationShelf || 'Estante Geral'}</span>
                        </div>

                        {book.publisher && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-church-navy/50">Editora / Edição:</span>
                            <span className="text-church-navy font-medium">{book.publisher} {book.edition ? `(${book.edition})` : ''}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-church-navy/5">
                          <span className="text-church-navy/50">Total no Acervo:</span>
                          <span className="font-black text-church-navy">{book.totalCopies} cópia(s)</span>
                        </div>

                        {book.description && (
                          <p className="text-[11px] text-church-navy/70 line-clamp-2 italic pt-1">
                            "{book.description}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-3 border-t border-church-navy/5 flex items-center justify-between gap-2">
                      {isAvailable ? (
                        canManage ? (
                          <button
                            onClick={() => handleOpenLoanModal(book)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-church-navy hover:bg-church-navy/90 text-white rounded-xl text-xs font-bold transition shadow-sm"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 text-church-gold" /> Emprestar
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Disponível para leitura
                          </span>
                        )
                      ) : (
                        <span className="text-xs font-semibold text-amber-700">
                          Todos exemplares emprestados
                        </span>
                      )}

                      {canManage && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenBookModal(book)}
                            className="p-1.5 rounded-lg text-church-navy/60 hover:text-church-navy hover:bg-church-navy/5 transition"
                            title="Editar Livro"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteItem({ id: book.id, type: 'book', name: book.title })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                            title="Excluir do Acervo"
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

      {/* TAB 2: CONTROLE DE EMPRÉSTIMOS */}
      {activeTab === 'loans' && (
        <div className="space-y-6">
          {/* Quick Notice Banner */}
          <div className="rounded-2xl bg-gradient-to-r from-church-navy to-church-navy/90 p-5 sm:p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-bold text-church-gold flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5" /> Controle de Devolução de Livros
              </h2>
              <p className="text-white/80 text-xs sm:text-sm max-w-2xl leading-relaxed">
                Acompanhe quem está lendo cada obra da casa do Senhor. Prazos sugeridos de 14 dias para permitir que outros irmãos também se edifiquem.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 text-white font-medium">
                {loans.filter(l => l.status === 'Devolvido').length} Devolvidos
              </span>
              <span className="text-xs bg-amber-500/20 text-amber-200 px-3 py-1.5 rounded-xl border border-amber-400/30 font-bold">
                {libraryMetrics.activeLoansCount} Ativos
              </span>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="bg-white p-3 rounded-2xl border border-church-navy/10 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-church-navy/40" />
              <input
                type="text"
                placeholder="Buscar por livro ou nome do membro..."
                value={loanSearch}
                onChange={(e) => setLoanSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-church-navy/15 text-xs focus:border-church-gold focus:outline-none bg-church-navy/[0.02]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {['Todos', 'Ativo', 'Atrasado', 'Renovado', 'Devolvido'].map(st => (
                <button
                  key={st}
                  onClick={() => setLoanStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                    loanStatusFilter === st
                      ? 'bg-church-navy text-white shadow-sm'
                      : 'bg-church-navy/5 text-church-navy/70 hover:bg-church-navy/10'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Loans Table / Cards */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-church-navy/40">
              <RefreshCw className="h-8 w-8 animate-spin text-church-gold mb-2" />
              <p className="text-sm font-medium">Carregando empréstimos...</p>
            </div>
          ) : filteredLoans.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-church-navy/20 bg-white p-12 text-center">
              <ArrowRightLeft className="mx-auto h-12 w-12 text-church-gold/50 mb-3" />
              <h3 className="font-serif text-lg font-bold text-church-navy">Nenhum empréstimo registrado</h3>
              <p className="text-church-navy/60 text-sm mt-1 max-w-md mx-auto">
                Registre os empréstimos para que a igreja mantenha o controle de cada livro e comentário bíblico.
              </p>
              {canManage && (
                <button
                  onClick={() => handleOpenLoanModal()}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-church-navy px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-church-navy/90"
                >
                  <ArrowRightLeft className="h-4 w-4 text-church-gold" /> Registrar Primeiro Empréstimo
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredLoans.map(loan => {
                const isOverdue = loan.status === 'Atrasado' || (loan.status === 'Ativo' && isPast(new Date(loan.expectedReturnDate + 'T23:59:59')));

                return (
                  <motion.div
                    key={loan.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-3xl bg-white p-5 border border-church-navy/10 shadow-sm hover:shadow-md transition space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                            loan.status === 'Devolvido'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : isOverdue
                              ? 'bg-red-100 text-red-800 border border-red-200 animate-pulse'
                              : loan.status === 'Renovado'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {loan.status === 'Devolvido' ? 'Devolvido' : isOverdue ? 'Atrasado' : loan.status}
                          </span>

                          <h4 className="font-serif text-base font-bold text-church-navy mt-1.5 line-clamp-1">
                            {loan.bookTitle}
                          </h4>
                          <p className="text-xs text-church-navy/60 font-medium">
                            por {loan.bookAuthor}
                          </p>
                        </div>

                        {canManage && (
                          <button
                            onClick={() => setDeleteItem({ id: loan.id, type: 'loan', name: `${loan.bookTitle} (${loan.memberName})` })}
                            className="p-1.5 rounded-lg text-church-navy/30 hover:text-red-600 hover:bg-red-50"
                            title="Excluir Registro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Borrower Info Card */}
                      <div className="bg-church-navy/[0.02] p-3 rounded-2xl border border-church-navy/5 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-church-navy/60">Irmão(ã) Leitor(a):</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-church-navy">{loan.memberName}</span>
                            {loan.memberPhone && (
                              <a
                                href={`https://wa.me/55${loan.memberPhone.replace(/\D/g, '')}?text=A%20paz%20do%20Senhor%20irmão(ã)%20${encodeURIComponent(loan.memberName)},%20tudo%20bem?%20Estamos%20entrando%20em%20contato%20sobre%20o%20livro%20"${encodeURIComponent(loan.bookTitle)}"%20da%20biblioteca%20da%20igreja.`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold text-[10px] flex items-center gap-1"
                              >
                                <Phone className="h-2.5 w-2.5" /> WhatsApp
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-church-navy/5 text-[11px]">
                          <div>
                            <span className="text-church-navy/50 block">Data de Retirada:</span>
                            <span className="font-medium text-church-navy">
                              {format(new Date(loan.loanDate + 'T00:00:00'), 'dd/MM/yyyy')}
                            </span>
                          </div>
                          <div>
                            <span className="text-church-navy/50 block">Devolução Prevista:</span>
                            <span className={`font-bold ${isOverdue ? 'text-red-600' : 'text-church-navy'}`}>
                              {format(new Date(loan.expectedReturnDate + 'T00:00:00'), 'dd/MM/yyyy')}
                            </span>
                          </div>
                        </div>

                        {loan.actualReturnDate && (
                          <div className="text-[11px] text-emerald-700 pt-1 border-t border-church-navy/5 font-medium flex items-center gap-1">
                            <Check className="h-3 w-3" /> Devolvido em: {format(new Date(loan.actualReturnDate + 'T00:00:00'), 'dd/MM/yyyy')}
                          </div>
                        )}

                        {loan.notes && (
                          <p className="text-[11px] text-church-navy/60 italic">
                            Nota: {loan.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bottom Loan Action Buttons */}
                    {canManage && loan.status !== 'Devolvido' && (
                      <div className="pt-2 border-t border-church-navy/5 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRenewLoan(loan)}
                          className="px-3 py-1.5 rounded-xl border border-church-navy/15 hover:bg-church-navy/5 text-church-navy text-xs font-bold transition"
                        >
                          +14 Dias (Renovar)
                        </button>
                        <button
                          onClick={() => handleReturnBook(loan)}
                          className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1 shadow-sm"
                        >
                          <Check className="h-3.5 w-3.5" /> Confirmar Devolução
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: CADASTRAR / EDITAR LIVRO */}
      <AnimatePresence>
        {isBookModalOpen && (
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
                    {editingBook ? 'Editar Livro do Acervo' : 'Cadastrar Livro na Biblioteca'}
                  </h3>
                  <p className="text-xs text-church-navy/60">Obras e comentários bíblicos da congregação</p>
                </div>
                <button
                  onClick={() => setIsBookModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveBook} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Título do Livro *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Comentário Bíblico Beacon, O Poder da Oração, Teologia Sistemática..."
                    value={bookForm.title}
                    onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Autor(a) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: C.S. Lewis, Charles Spurgeon, Wayne Grudem..."
                    value={bookForm.author}
                    onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Categoria / Gênero
                    </label>
                    <select
                      value={bookForm.category}
                      onChange={(e) => setBookForm({ ...bookForm, category: e.target.value as any })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    >
                      {BOOK_CATEGORIES.filter(c => c !== 'Todos').map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Localização / Estante
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Estante 2 - Prateleira B"
                      value={bookForm.locationShelf}
                      onChange={(e) => setBookForm({ ...bookForm, locationShelf: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Total de Exemplares
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={bookForm.totalCopies}
                      onChange={(e) => setBookForm({ ...bookForm, totalCopies: parseInt(e.target.value) || 1 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Exemplares Disponíveis
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={bookForm.totalCopies}
                      required
                      value={bookForm.availableCopies}
                      onChange={(e) => setBookForm({ ...bookForm, availableCopies: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Editora
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: CPAD, Vida, Thomas Nelson..."
                      value={bookForm.publisher}
                      onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      ISBN / Registro
                    </label>
                    <input
                      type="text"
                      placeholder="Opcional"
                      value={bookForm.isbn}
                      onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Sinopse / Observações
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Breve resumo sobre a temática ou comentários do livro..."
                    value={bookForm.description}
                    onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsBookModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    {editingBook ? 'Atualizar Livro' : 'Salvar no Acervo'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: REGISTRAR EMPRÉSTIMO */}
      <AnimatePresence>
        {isLoanModalOpen && (
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
                    Registrar Empréstimo de Livro
                  </h3>
                  <p className="text-xs text-church-navy/60">Registre o irmão leitor e o prazo de devolução</p>
                </div>
                <button
                  onClick={() => setIsLoanModalOpen(false)}
                  className="p-2 rounded-xl text-church-navy/40 hover:text-church-navy hover:bg-church-navy/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveLoan} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Selecionar Livro *
                  </label>
                  <select
                    required
                    value={loanForm.bookId}
                    onChange={(e) => {
                      const selected = books.find(b => b.id === e.target.value);
                      if (selected) {
                        setLoanForm({
                          ...loanForm,
                          bookId: selected.id,
                          bookTitle: selected.title,
                          bookAuthor: selected.author
                        });
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  >
                    <option value="">Selecione uma obra...</option>
                    {books.map(b => (
                      <option key={b.id} value={b.id} disabled={(b.availableCopies ?? b.totalCopies) <= 0}>
                        {b.title} - {b.author} ({b.availableCopies ?? b.totalCopies} disp.)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Nome do Irmão(ã) / Leitor *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Nome de quem está levando o livro"
                    value={loanForm.memberName}
                    onChange={(e) => setLoanForm({ ...loanForm, memberName: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />

                  {/* Quick member suggestions */}
                  {membersList.length > 0 && !loanForm.memberName && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="text-[10px] text-church-navy/50 mr-1">Membros cadastrados:</span>
                      {membersList.slice(0, 3).map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setLoanForm({ ...loanForm, memberName: m.name, memberPhone: m.phone || '' })}
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
                    Telefone / WhatsApp para Contato
                  </label>
                  <input
                    type="tel"
                    placeholder="(99) 99999-9999"
                    value={loanForm.memberPhone}
                    onChange={(e) => setLoanForm({ ...loanForm, memberPhone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Data de Retirada *
                    </label>
                    <input
                      type="date"
                      required
                      value={loanForm.loanDate}
                      onChange={(e) => setLoanForm({ ...loanForm, loanDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                      Prazo de Devolução *
                    </label>
                    <input
                      type="date"
                      required
                      value={loanForm.expectedReturnDate}
                      onChange={(e) => setLoanForm({ ...loanForm, expectedReturnDate: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-church-navy uppercase tracking-wider mb-1">
                    Observações Adicionais
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Empréstimo para aula de EBD, livro entregue com capa plástica..."
                    value={loanForm.notes}
                    onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-church-navy/20 text-sm focus:border-church-gold focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-church-navy/10">
                  <button
                    type="button"
                    onClick={() => setIsLoanModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-church-navy/20 text-sm font-bold text-church-navy hover:bg-church-navy/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-church-navy text-sm font-bold text-white shadow-lg shadow-church-navy/20 hover:bg-church-navy/90"
                  >
                    Confirmar Retirada
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
        title={deleteItem?.type === 'book' ? 'Excluir Livro do Acervo' : 'Excluir Registro de Empréstimo'}
        message={`Tem certeza que deseja remover "${deleteItem?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={confirmDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
