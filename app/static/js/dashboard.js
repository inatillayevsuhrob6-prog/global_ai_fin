(() => {
    const token = () => localStorage.getItem("access_token");
    const money = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });
    const monthNames = [
        "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
        "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"
    ];
    let toastTimeout;

    function formatMoney(value) {
        return `${money.format(Number(value) || 0)} so'm`;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("uz-UZ", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function inputDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    }

    function showToast(message, isError = false) {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.className = `pointer-events-none fixed bottom-5 right-5 z-50 rounded-xl border px-4 py-3 text-sm shadow-2xl transition-all duration-300 ${
            isError
                ? "border-rose-400/20 bg-slate-900/95 text-rose-200"
                : "border-emerald-400/20 bg-slate-900/95 text-emerald-200"
        }`;
        requestAnimationFrame(() => toast.classList.remove("translate-y-4", "opacity-0"));
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.add("translate-y-4", "opacity-0");
        }, 3200);
    }

    async function api(path, options = {}) {
        const headers = new Headers(options.headers || {});
        if (token()) headers.set("Authorization", `Bearer ${token()}`);
        if (options.body && !(options.body instanceof FormData)) {
            headers.set("Content-Type", "application/json");
        }
        const response = await fetch(path, { ...options, headers });
        if (response.status === 204) return null;

        const contentType = response.headers.get("content-type") || "";
        let result = null;
        if (contentType.includes("application/json")) {
            try {
                result = await response.json();
            } catch {
                throw new Error(`Serverdan noto'g'ri JSON javob olindi (HTTP ${response.status}).`);
            }
        }
        if (!response.ok) {
            const detail = result?.detail;
            const message = Array.isArray(detail)
                ? detail.map((item) => item.msg).join(", ")
                : detail || `Server so'rovni bajara olmadi (HTTP ${response.status}). Qayta urinib ko'ring.`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        if (result === null) throw new Error("Serverdan noto'g'ri javob olindi.");
        return result;
    }

    function animateNumber(element, value) {
        let number = element.querySelector("[data-stat-number]");
        if (!number) {
            number = document.createElement("span");
            number.dataset.statNumber = "";
            element.prepend(number);
        }
        const start = Number(element.dataset.value || 0);
        const end = Number(value) || 0;
        const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;
        element.dataset.value = String(end);
        if (!duration) {
            number.textContent = `${money.format(end)} `;
            return;
        }
        const startTime = performance.now();
        const update = (now) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            number.textContent = `${money.format(start + (end - start) * eased)} `;
            if (progress < 1) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    function amountElement(amount, type) {
        const element = document.createElement("span");
        element.className = type === "income" ? "font-semibold text-emerald-300" : "font-semibold text-rose-300";
        element.textContent = `${type === "income" ? "+" : "−"}${formatMoney(amount)}`;
        return element;
    }

    function setEmptyRow(tbody, columns, message) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = columns;
        cell.className = "px-5 py-10 text-center text-sm text-slate-500";
        cell.textContent = message;
        row.append(cell);
        tbody.replaceChildren(row);
    }

    function buildTransactionRow(transaction, deletable = false) {
        const row = document.createElement("tr");
        row.className = "transition-colors hover:bg-white/[.035]";
        const nameCell = document.createElement("td");
        nameCell.className = "px-5 py-4";
        const title = document.createElement("p");
        title.className = "font-medium text-slate-200";
        title.textContent = transaction.description || (transaction.type === "income" ? "Daromad" : "Xarajat");
        nameCell.append(title);
        row.append(nameCell);

        const category = document.createElement("td");
        category.className = "px-5 py-4 text-slate-400";
        category.textContent = transaction.category;
        row.append(category);

        const date = document.createElement("td");
        date.className = "px-5 py-4 text-slate-400";
        date.textContent = formatDate(transaction.date);
        row.append(date);

        const amount = document.createElement("td");
        amount.className = "px-5 py-4 text-right";
        amount.append(amountElement(transaction.amount, transaction.type));
        row.append(amount);

        if (deletable) {
            const actions = document.createElement("td");
            actions.className = "px-5 py-4 text-right";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.dataset.editTransaction = String(transaction.id);
            edit.className = "mr-1 rounded-lg p-2 text-slate-500 transition hover:bg-violet-500/10 hover:text-violet-300";
            edit.setAttribute("aria-label", "Operatsiyani tahrirlash");
            edit.innerHTML = '<i data-lucide="pencil" class="h-4 w-4"></i>';
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.deleteTransaction = String(transaction.id);
            remove.className = "rounded-lg p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300";
            remove.setAttribute("aria-label", "Operatsiyani o'chirish");
            remove.innerHTML = '<i data-lucide="trash-2" class="h-4 w-4"></i>';
            actions.append(edit, remove);
            row.append(actions);
        }
        return row;
    }

    function renderDashboardInsights(data) {
        const history = Array.isArray(data.monthly_history) ? data.monthly_history : [];
        const chart = document.getElementById("monthly-chart");
        const maxAmount = Math.max(
            1,
            ...history.flatMap((item) => [Number(item.income) || 0, Number(item.expense) || 0])
        );
        const accessibleMonths = [];
        chart.replaceChildren(...history.map((item) => {
            const monthName = monthNames[item.month - 1] || String(item.month);
            accessibleMonths.push(
                `${monthName} ${item.year}: daromad ${formatMoney(item.income)}, xarajat ${formatMoney(item.expense)}`
            );
            const column = document.createElement("div");
            column.className = "flex h-full min-w-0 flex-col items-center justify-end";
            const bars = document.createElement("div");
            bars.className = "flex h-full w-full items-end justify-center gap-1";
            for (const [field, color, label] of [
                ["income", "bg-blue-500", "Daromad"],
                ["expense", "bg-cyan-400", "Xarajat"]
            ]) {
                const bar = document.createElement("div");
                const value = Math.max(0, Number(item[field]) || 0);
                bar.className = `w-3 max-w-[40%] rounded-t-md ${color} transition-[height] duration-700 sm:w-5`;
                bar.style.height = `${Math.max(value ? 4 : 0, value / maxAmount * 100)}%`;
                bar.title = `${label}: ${formatMoney(value)}`;
                bars.append(bar);
            }
            const monthLabel = document.createElement("span");
            monthLabel.className = "mt-2 text-[10px] text-slate-500 sm:text-xs";
            monthLabel.textContent = monthName.slice(0, 3);
            column.append(bars, monthLabel);
            return column;
        }));
        chart.setAttribute(
            "aria-label",
            accessibleMonths.length ? accessibleMonths.join(". ") : "Hozircha oylik statistika yo'q."
        );
        if (!history.length) {
            const empty = document.createElement("p");
            empty.className = "col-span-6 self-center text-center text-sm text-slate-500";
            empty.textContent = "Hozircha oylik statistika yo'q.";
            chart.append(empty);
        }

        const saved = Number(data.goal_saved) || 0;
        const target = Number(data.goal_target) || 0;
        const goalCount = Number(data.active_goals) || 0;
        const progress = Math.min(Math.max(Number(data.goal_progress_percent) || 0, 0), 100);
        document.getElementById("goal-progress-amount").textContent =
            `${formatMoney(saved)} / ${formatMoney(target)}`;
        document.getElementById("goal-progress-bar").style.width = `${progress}%`;
        document.getElementById("goal-progress-label").textContent = goalCount
            ? `${goalCount} ta faol maqsad · ${Math.round(progress)}% umumiy bajarildi`
            : "Hali faol jamg'arma maqsadi yo'q.";
        document.getElementById("stat-savings-rate").lastChild.textContent =
            `Jamg'arish: ${Number(data.savings_rate) || 0}% · ${Number(data.monthly_transaction_count) || 0} operatsiya`;
    }

    async function loadDashboard() {
        const data = await api("/api/dashboard/stats");
        for (const [id, value] of [
            ["stat-balance", data.balance],
            ["stat-income", data.income],
            ["stat-expense", data.expense],
            ["stat-net", data.monthly_net],
            ["stat-goal-count", data.active_goals]
        ]) {
            const element = document.getElementById(id);
            animateNumber(element, value);
        }
        const netNumber = document.querySelector("#stat-net [data-stat-number]");
        netNumber.classList.remove("text-emerald-300", "text-rose-300");
        netNumber.classList.add(Number(data.monthly_net) >= 0 ? "text-emerald-300" : "text-rose-300");
        renderDashboardInsights(data);
        const recent = document.getElementById("recent-transactions");
        if (!data.transactions.length) {
            setEmptyRow(recent, 4, "Hali operatsiyalar yo'q. Birinchi operatsiyangizni qo'shing.");
        } else {
            recent.replaceChildren(...data.transactions.map((item) => buildTransactionRow(item)));
        }
        if (window.lucide) window.lucide.createIcons();
    }

    async function loadTransactions() {
        const transactions = await api("/api/transactions");
        const tbody = document.getElementById("all-transactions");
        if (!transactions.length) {
            setEmptyRow(tbody, 5, "Hali operatsiyalar yo'q.");
        } else {
            tbody.replaceChildren(...transactions.map((item) => buildTransactionRow(item, true)));
        }
        if (window.lucide) window.lucide.createIcons();
    }

    function populateBudgetPeriod() {
        const month = document.getElementById("budget-month");
        month.replaceChildren(...monthNames.map((name, index) => {
            const option = document.createElement("option");
            option.value = String(index + 1);
            option.textContent = name;
            return option;
        }));
        month.value = String(new Date().getMonth() + 1);
        document.getElementById("budget-year").value = String(new Date().getFullYear());
    }

    async function loadBudgets() {
        const month = Number(document.getElementById("budget-month").value);
        const year = Number(document.getElementById("budget-year").value);
        if (!month || !year) return;
        const budgets = await api(`/api/budgets?month=${month}&year=${year}`);
        const list = document.getElementById("budget-list");
        if (!budgets.length) {
            list.innerHTML = '<div class="glass-panel rounded-2xl p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">Bu oy uchun byudjet belgilanmagan.</div>';
            return;
        }
        list.replaceChildren(...budgets.map((budget) => {
            const card = document.createElement("article");
            card.className = "glass-panel rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/20";
            const ratio = budget.limit_amount > 0
                ? Math.min((budget.spent_amount / budget.limit_amount) * 100, 100)
                : 0;
            const overLimit = budget.spent_amount > budget.limit_amount;
            const header = document.createElement("div");
            header.className = "flex items-start justify-between gap-3";
            const title = document.createElement("div");
            const name = document.createElement("h2");
            name.className = "font-semibold text-white";
            name.textContent = budget.category;
            const period = document.createElement("p");
            period.className = "mt-1 text-xs text-slate-500";
            period.textContent = `${monthNames[budget.month - 1]} ${budget.year}`;
            title.append(name, period);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.deleteBudget = String(budget.id);
            remove.className = "rounded-lg p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300";
            remove.setAttribute("aria-label", "Byudjetni o'chirish");
            remove.innerHTML = '<i data-lucide="trash-2" class="h-4 w-4"></i>';
            const edit = document.createElement("button");
            edit.type = "button";
            edit.dataset.editBudget = "";
            edit.dataset.category = budget.category;
            edit.dataset.limit = String(budget.limit_amount);
            edit.dataset.month = String(budget.month);
            edit.dataset.year = String(budget.year);
            edit.className = "rounded-lg p-2 text-slate-500 transition hover:bg-cyan-500/10 hover:text-cyan-300";
            edit.setAttribute("aria-label", "Byudjetni tahrirlash");
            edit.innerHTML = '<i data-lucide="pencil" class="h-4 w-4"></i>';
            const controls = document.createElement("div");
            controls.className = "flex";
            controls.append(edit, remove);
            header.append(title, controls);
            const amounts = document.createElement("div");
            amounts.className = "mt-6 flex items-end justify-between gap-3";
            const spent = document.createElement("p");
            spent.className = `text-lg font-bold ${overLimit ? "text-rose-300" : "text-white"}`;
            spent.textContent = formatMoney(budget.spent_amount);
            const limit = document.createElement("p");
            limit.className = "text-xs text-slate-500";
            limit.textContent = `Limit: ${formatMoney(budget.limit_amount)}`;
            amounts.append(spent, limit);
            const track = document.createElement("div");
            track.className = "mt-3 h-2 overflow-hidden rounded-full bg-white/[.06]";
            const fill = document.createElement("div");
            fill.className = `h-full rounded-full transition-all duration-700 ${overLimit ? "bg-gradient-to-r from-rose-500 to-orange-400" : "bg-gradient-to-r from-cyan-500 to-blue-500"}`;
            fill.style.width = `${ratio}%`;
            track.append(fill);
            const remaining = document.createElement("p");
            remaining.className = "mt-3 text-xs text-slate-500";
            remaining.textContent = overLimit
                ? `Limitdan ${formatMoney(budget.spent_amount - budget.limit_amount)} oshdi`
                : `Qoldi: ${formatMoney(budget.limit_amount - budget.spent_amount)}`;
            card.append(header, amounts, track, remaining);
            return card;
        }));
        if (window.lucide) window.lucide.createIcons();
    }

    async function loadGoals() {
        const goals = await api("/api/goals");
        const list = document.getElementById("goal-list");
        if (!goals.length) {
            list.innerHTML = '<div class="glass-panel rounded-2xl p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">Hali maqsad yo\'q. Birinchi jamg\'arma maqsadingizni yarating.</div>';
            return;
        }
        list.replaceChildren(...goals.map((goal) => {
            const card = document.createElement("article");
            card.className = "glass-panel rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-emerald-400/20";
            const header = document.createElement("div");
            header.className = "flex items-start justify-between gap-3";
            const name = document.createElement("h2");
            name.className = "font-semibold text-white";
            name.textContent = goal.name;
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.deleteGoal = String(goal.id);
            remove.className = "rounded-lg p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300";
            remove.setAttribute("aria-label", "Maqsadni o'chirish");
            remove.innerHTML = '<i data-lucide="trash-2" class="h-4 w-4"></i>';
            header.append(name, remove);
            const ratio = goal.target_amount > 0
                ? Math.min((goal.current_amount / goal.target_amount) * 100, 100)
                : 0;
            const amounts = document.createElement("div");
            amounts.className = "mt-6 flex items-end justify-between gap-3";
            const current = document.createElement("p");
            current.className = "text-lg font-bold text-emerald-200";
            current.textContent = formatMoney(goal.current_amount);
            const target = document.createElement("p");
            target.className = "text-xs text-slate-500";
            target.textContent = `Maqsad: ${formatMoney(goal.target_amount)}`;
            amounts.append(current, target);
            const track = document.createElement("div");
            track.className = "mt-3 h-2 overflow-hidden rounded-full bg-white/[.06]";
            const fill = document.createElement("div");
            fill.className = "h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-300 transition-all duration-700";
            fill.style.width = `${ratio}%`;
            track.append(fill);
            const footer = document.createElement("div");
            footer.className = "mt-4 flex items-center justify-between gap-3";
            const status = document.createElement("span");
            status.className = "text-xs text-slate-500";
            status.textContent = goal.is_completed ? "Maqsad bajarildi!" : `${Math.round(ratio)}% · ${goal.deadline ? formatDate(goal.deadline) + " gacha" : "Muddat belgilanmagan"}`;
            footer.append(status);
            const editDetails = document.createElement("details");
            editDetails.className = "mt-4 border-t border-white/[.06] pt-3";
            const summary = document.createElement("summary");
            summary.className = "cursor-pointer text-xs font-medium text-slate-400 transition hover:text-emerald-200";
            summary.textContent = "Maqsadni tahrirlash";
            const editForm = document.createElement("form");
            editForm.dataset.updateGoal = String(goal.id);
            editForm.className = "mt-3 grid gap-2";
            const nameInput = document.createElement("input");
            nameInput.name = "name";
            nameInput.value = goal.name;
            nameInput.maxLength = 100;
            nameInput.required = true;
            nameInput.className = "rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400";
            const targetInput = document.createElement("input");
            targetInput.name = "target_amount";
            targetInput.type = "number";
            targetInput.min = "1";
            targetInput.step = "any";
            targetInput.value = String(goal.target_amount);
            targetInput.required = true;
            targetInput.className = "rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400";
            const deadlineInput = document.createElement("input");
            deadlineInput.name = "deadline";
            deadlineInput.type = "date";
            deadlineInput.value = inputDate(goal.deadline);
            deadlineInput.className = "rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400";
            const save = document.createElement("button");
            save.type = "submit";
            save.className = "rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/25";
            save.textContent = "O'zgarishlarni saqlash";
            editForm.append(nameInput, targetInput, deadlineInput, save);
            editDetails.append(summary, editForm);
            card.append(editDetails);
            if (!goal.is_completed) {
                const addForm = document.createElement("form");
                addForm.dataset.contributeGoal = String(goal.id);
                addForm.className = "flex gap-2";
                const amount = document.createElement("input");
                amount.name = "amount";
                amount.type = "number";
                amount.min = "1";
                amount.step = "any";
                amount.required = true;
                amount.placeholder = "Summa";
                amount.className = "w-24 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-2 text-xs text-white outline-none focus:border-emerald-400";
                const button = document.createElement("button");
                button.type = "submit";
                button.className = "rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/25";
                button.textContent = "Qo'shish";
                addForm.append(amount, button);
                footer.append(addForm);
            }
            card.append(header, amounts, track, footer);
            return card;
        }));
        if (window.lucide) window.lucide.createIcons();
    }

    async function navigate(page) {
        const target = document.querySelector(`[data-section="${page}"]`);
        if (!target) return;
        document.querySelectorAll(".page-section").forEach((section) => section.classList.add("hidden"));
        target.classList.remove("hidden");
        target.classList.remove("page-enter");
        void target.offsetWidth;
        target.classList.add("page-enter");
        document.querySelectorAll(".nav-item").forEach((item) => {
            item.classList.toggle("active", item.dataset.page === page);
        });
        closeMobileMenu();
        try {
            if (page === "overview") await loadDashboard();
            if (page === "transactions") await loadTransactions();
            if (page === "budgets") await loadBudgets();
            if (page === "goals") await loadGoals();
        } catch (error) {
            showToast(error.message, true);
        }
    }

    const sidebar = document.getElementById("dashboard-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    function openMobileMenu() {
        sidebar.classList.remove("-translate-x-full");
        backdrop.classList.remove("hidden");
    }
    function closeMobileMenu() {
        sidebar.classList.add("-translate-x-full");
        backdrop.classList.add("hidden");
    }

    document.querySelectorAll("[data-page]").forEach((button) => {
        button.addEventListener("click", () => navigate(button.dataset.page));
    });
    document.querySelectorAll("[data-go-page]").forEach((button) => {
        button.addEventListener("click", () => navigate(button.dataset.goPage));
    });
    document.getElementById("mobile-menu-toggle").addEventListener("click", openMobileMenu);
    document.getElementById("mobile-close").addEventListener("click", closeMobileMenu);
    backdrop.addEventListener("click", closeMobileMenu);
    document.getElementById("logout-button").addEventListener("click", () => {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
    });
    document.getElementById("budget-month").addEventListener("change", () => loadBudgets().catch((error) => showToast(error.message, true)));
    document.getElementById("budget-year").addEventListener("change", () => loadBudgets().catch((error) => showToast(error.message, true)));

    document.getElementById("transaction-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const transactionId = String(values.get("transaction_id") || "");
        const dateValue = values.get("date");
        const payload = {
            type: values.get("type"),
            amount: Number(values.get("amount")),
            category: String(values.get("category")).trim(),
            description: String(values.get("description")).trim() || null,
            date: dateValue ? new Date(`${dateValue}T12:00:00`).toISOString() : null
        };
        try {
            await api(
                transactionId ? `/api/transactions/${transactionId}` : "/api/transactions",
                { method: transactionId ? "PUT" : "POST", body: JSON.stringify(payload) }
            );
            form.reset();
            document.getElementById("transaction-submit").textContent = "Operatsiyani saqlash";
            document.getElementById("transaction-cancel-edit").classList.add("hidden");
            showToast(transactionId ? "Operatsiya yangilandi." : "Operatsiya saqlandi.");
            await Promise.all([loadTransactions(), loadDashboard(), loadBudgets()]);
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("all-transactions").addEventListener("click", async (event) => {
        const editButton = event.target.closest("[data-edit-transaction]");
        if (editButton) {
            try {
                const transactions = await api("/api/transactions");
                const transaction = transactions.find((item) => String(item.id) === editButton.dataset.editTransaction);
                if (!transaction) throw new Error("Operatsiya topilmadi.");
                const form = document.getElementById("transaction-form");
                form.elements.transaction_id.value = String(transaction.id);
                form.elements.type.value = transaction.type;
                form.elements.amount.value = String(transaction.amount);
                form.elements.category.value = transaction.category;
                form.elements.description.value = transaction.description;
                form.elements.date.value = inputDate(transaction.date);
                document.getElementById("transaction-submit").textContent = "O'zgarishlarni saqlash";
                document.getElementById("transaction-cancel-edit").classList.remove("hidden");
                form.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (error) {
                showToast(error.message, true);
            }
            return;
        }
        const button = event.target.closest("[data-delete-transaction]");
        if (!button || !window.confirm("Ushbu operatsiyani o'chirmoqchimisiz?")) return;
        try {
            await api(`/api/transactions/${button.dataset.deleteTransaction}`, { method: "DELETE" });
            showToast("Operatsiya o'chirildi.");
            await Promise.all([loadTransactions(), loadDashboard(), loadBudgets()]);
        } catch (error) {
            showToast(error.message, true);
        }
    });
    document.getElementById("transaction-cancel-edit").addEventListener("click", () => {
        document.getElementById("transaction-form").reset();
        document.getElementById("transaction-submit").textContent = "Operatsiyani saqlash";
        document.getElementById("transaction-cancel-edit").classList.add("hidden");
    });

    document.getElementById("budget-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        try {
            await api("/api/budgets", {
                method: "POST",
                body: JSON.stringify({
                    category: String(values.get("category")).trim(),
                    limit_amount: Number(values.get("limit_amount")),
                    month: Number(values.get("month")),
                    year: Number(values.get("year"))
                })
            });
            form.elements.category.value = "";
            form.elements.limit_amount.value = "";
            showToast("Byudjet saqlandi.");
            await loadBudgets();
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("budget-list").addEventListener("click", async (event) => {
        const editButton = event.target.closest("[data-edit-budget]");
        if (editButton) {
            const form = document.getElementById("budget-form");
            form.elements.category.value = editButton.dataset.category;
            form.elements.limit_amount.value = editButton.dataset.limit;
            form.elements.month.value = editButton.dataset.month;
            form.elements.year.value = editButton.dataset.year;
            form.scrollIntoView({ behavior: "smooth", block: "center" });
            form.elements.limit_amount.focus();
            showToast("Byudjet limitini o'zgartirib saqlang.");
            return;
        }
        const button = event.target.closest("[data-delete-budget]");
        if (!button || !window.confirm("Ushbu byudjetni o'chirmoqchimisiz?")) return;
        try {
            await api(`/api/budgets/${button.dataset.deleteBudget}`, { method: "DELETE" });
            showToast("Byudjet o'chirildi.");
            await loadBudgets();
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("goal-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const deadline = values.get("deadline");
        try {
            await api("/api/goals", {
                method: "POST",
                body: JSON.stringify({
                    name: String(values.get("name")).trim(),
                    target_amount: Number(values.get("target_amount")),
                    deadline: deadline ? new Date(`${deadline}T12:00:00`).toISOString() : null
                })
            });
            form.reset();
            showToast("Jamg'arma maqsadi yaratildi.");
            await loadGoals();
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("goal-list").addEventListener("submit", async (event) => {
        const updateForm = event.target.closest("[data-update-goal]");
        if (updateForm) {
            event.preventDefault();
            const values = new FormData(updateForm);
            const deadline = values.get("deadline");
            try {
                await api(`/api/goals/${updateForm.dataset.updateGoal}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        name: String(values.get("name")).trim(),
                        target_amount: Number(values.get("target_amount")),
                        deadline: deadline ? new Date(`${deadline}T12:00:00`).toISOString() : null
                    })
                });
                showToast("Maqsad yangilandi.");
                await loadGoals();
            } catch (error) {
                showToast(error.message, true);
            }
            return;
        }
        const form = event.target.closest("[data-contribute-goal]");
        if (!form) return;
        event.preventDefault();
        const amount = Number(new FormData(form).get("amount"));
        try {
            await api(`/api/goals/${form.dataset.contributeGoal}/contributions`, {
                method: "POST",
                body: JSON.stringify({ amount })
            });
            showToast("Maqsadga mablag' qo'shildi.");
            await loadGoals();
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("goal-list").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-delete-goal]");
        if (!button || !window.confirm("Ushbu maqsadni o'chirmoqchimisiz?")) return;
        try {
            await api(`/api/goals/${button.dataset.deleteGoal}`, { method: "DELETE" });
            showToast("Maqsad o'chirildi.");
            await loadGoals();
        } catch (error) {
            showToast(error.message, true);
        }
    });

    function appendChatMessage(text, fromUser) {
        const message = document.createElement("div");
        message.className = `max-w-[88%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-6 ${
            fromUser
                ? "ml-auto rounded-tr-sm bg-blue-600/20 text-blue-100"
                : "rounded-tl-sm border border-violet-400/15 bg-violet-500/10 text-slate-200"
        }`;
        message.textContent = text;
        const messages = document.getElementById("chat-messages");
        messages.append(message);
        messages.scrollTop = messages.scrollHeight;
        return message;
    }

    document.getElementById("chat-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.elements.message;
        const message = input.value.trim();
        if (!message) return;
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");
        appendChatMessage(message, true);
        input.value = "";
        const waiting = appendChatMessage("Javob tayyorlanmoqda...", false);
        try {
            const result = await api("/api/chat", {
                method: "POST",
                body: JSON.stringify({ message })
            });
            waiting.textContent = result.response || "AI javob qaytarmadi.";
        } catch (error) {
            waiting.textContent = error.message;
            waiting.classList.add("border-rose-400/20", "bg-rose-500/10", "text-rose-200");
        } finally {
            submitButton.disabled = false;
            submitButton.removeAttribute("aria-busy");
        }
        const messages = document.getElementById("chat-messages");
        messages.scrollTop = messages.scrollHeight;
    });

    function appendText(parent, tag, text, className = "") {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        parent.append(element);
        return element;
    }

    function renderAutopilot(data) {
        const root = document.getElementById("autopilot-results");
        root.replaceChildren();
        appendText(root, "p", `So'nggi ${data.period_days} kun · Oylik daromad ${formatMoney(data.monthly_income)} · Xarajat ${formatMoney(data.monthly_expenses)}`, "text-xs text-slate-400");
        if (!data.recommendations.length) {
            appendText(root, "p", "Hozircha aniq tavsiya yo'q. Yetarli operatsiya to'plangach tahlil yanada foydali bo'ladi.", "rounded-xl bg-white/[.03] p-3 text-slate-400");
        }
        data.recommendations.forEach((recommendation) => {
            const card = document.createElement("div");
            card.className = "rounded-xl border border-violet-400/10 bg-violet-500/[.06] p-3";
            appendText(card, "p", recommendation.message, "text-sm text-slate-200");
            if (recommendation.usage_percent !== undefined) {
                appendText(card, "p", `${formatMoney(recommendation.spent)} / ${formatMoney(recommendation.limit)} · ${recommendation.usage_percent}%`, "mt-1 text-xs text-slate-400");
            }
            root.append(card);
        });
        appendText(root, "h3", "Takrorlanuvchi to'lov ehtimollari", "mt-3 font-semibold");
        if (!data.recurring_candidates.length) {
            appendText(root, "p", "Takroriy obuna aniqlanmadi (ma'lumot yetarli bo'lmasligi mumkin).", "text-xs text-slate-500");
        } else {
            data.recurring_candidates.forEach((item) => {
                appendText(root, "p", `${item.category}: ${formatMoney(item.amount)} · ${item.confidence}`, "text-xs text-slate-300");
            });
        }
        appendText(root, "h3", "G'ayrioddiy yozuvlar", "mt-3 font-semibold");
        if (!data.anomalies.length) {
            appendText(root, "p", "Tanlangan davrda statistik og'ish topilmadi.", "text-xs text-slate-500");
        } else {
            data.anomalies.forEach((item) => {
                appendText(root, "p", `${item.transaction.category}: ${formatMoney(item.transaction.amount)} · odatdagi medianadan ${item.ratio}x`, "text-xs text-amber-200");
            });
        }
        appendText(root, "p", data.disclaimer, "mt-3 text-[11px] leading-5 text-slate-500");
    }

    document.getElementById("autopilot-run").addEventListener("click", async () => {
        const button = document.getElementById("autopilot-run");
        button.disabled = true;
        button.textContent = "Tahlil qilinmoqda...";
        try {
            const data = await api("/api/premium/autopilot");
            renderAutopilot(data);
            const twinForm = document.getElementById("twin-form");
            twinForm.elements.monthly_income.value = String(Math.round(data.monthly_income));
            twinForm.elements.monthly_expenses.value = String(Math.round(data.monthly_expenses));
            showToast("Moliyaviy tahlil tayyor.");
        } catch (error) {
            showToast(error.message, true);
        } finally {
            button.disabled = false;
            button.textContent = "Moliyamni tahlil qilish";
        }
    });

    function drawProjection(projection) {
        const canvas = document.getElementById("twin-chart");
        const bounds = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(320, bounds.width * ratio);
        canvas.height = 180 * ratio;
        const context = canvas.getContext("2d");
        context.scale(ratio, ratio);
        const width = canvas.width / ratio;
        const height = canvas.height / ratio;
        const values = projection.map((point) => point.projected_balance);
        const min = Math.min(0, ...values);
        const max = Math.max(1, ...values);
        const padding = { left: 48, right: 12, top: 12, bottom: 28 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        context.clearRect(0, 0, width, height);
        context.font = "10px Inter, sans-serif";
        context.fillStyle = "rgba(203,213,225,.65)";
        context.strokeStyle = "rgba(148,163,184,.13)";
        context.lineWidth = 1;
        for (let grid = 0; grid <= 4; grid += 1) {
            const y = padding.top + chartHeight * grid / 4;
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();
            const labelValue = max - (max - min) * grid / 4;
            context.fillText(money.format(labelValue), 0, y + 3);
        }
        const points = values.map((value, index) => ({
            x: padding.left + chartWidth * index / Math.max(1, values.length - 1),
            y: padding.top + chartHeight * (max - value) / (max - min || 1)
        }));
        const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, "rgba(129,140,248,.32)");
        gradient.addColorStop(1, "rgba(129,140,248,0)");
        context.beginPath();
        points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.lineTo(points.at(-1).x, height - padding.bottom);
        context.lineTo(points[0].x, height - padding.bottom);
        context.closePath();
        context.fillStyle = gradient;
        context.fill();
        context.beginPath();
        points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.strokeStyle = "#a5b4fc";
        context.lineWidth = 2.5;
        context.stroke();
        points.forEach((point, index) => {
            if (index % Math.ceil(points.length / 6) !== 0 && index !== points.length - 1) return;
            context.beginPath();
            context.arc(point.x, point.y, 3, 0, Math.PI * 2);
            context.fillStyle = "#c4b5fd";
            context.fill();
        });
    }

    document.getElementById("twin-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const payload = Object.fromEntries(values.entries());
        for (const key of ["months", "monthly_income", "monthly_expenses", "monthly_savings", "annual_inflation_percent"]) {
            payload[key] = Number(payload[key]);
        }
        try {
            const result = await api("/api/premium/digital-twin", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            document.getElementById("twin-chart").classList.remove("hidden");
            drawProjection(result.projection);
            const output = document.getElementById("twin-result");
            output.replaceChildren();
            appendText(output, "p", `Taxminiy yakuniy balans: ${formatMoney(result.ending_balance)}`, "font-semibold text-indigo-200");
            appendText(output, "p", result.disclaimer, "mt-1 text-xs text-slate-500");
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("war-room-run").addEventListener("click", async () => {
        const button = document.getElementById("war-room-run");
        button.disabled = true;
        button.textContent = "6 agent tahlil qilmoqda...";
        try {
            const report = await api("/api/premium/war-room");
            const root = document.getElementById("war-room-results");
            root.replaceChildren();
            report.agents.forEach((agent) => {
                const card = document.createElement("article");
                card.className = "rounded-xl border border-white/[.07] bg-white/[.025] p-3";
                appendText(card, "h3", agent.agent, "text-sm font-semibold text-amber-100");
                const findings = agent.findings;
                if (Array.isArray(findings)) {
                    if (!findings.length) appendText(card, "p", "Xavotirli holat aniqlanmadi.", "mt-2 text-xs text-slate-500");
                    findings.slice(0, 5).forEach((finding) => {
                        const summary = typeof finding === "string"
                            ? finding
                            : finding.category
                                ? `${finding.category}: ${finding.usage_percent !== undefined ? `${finding.usage_percent}%` : formatMoney(finding.amount || finding.remaining || 0)}`
                                : finding.name
                                    ? `${finding.name}: ${finding.progress_percent ?? ""}%`
                                    : JSON.stringify(finding);
                        appendText(card, "p", summary, "mt-2 text-xs leading-5 text-slate-300");
                    });
                } else {
                    Object.entries(findings).forEach(([key, value]) => {
                        const label = key.replaceAll("_", " ");
                        const display = typeof value === "number" ? formatMoney(value) : String(value);
                        appendText(card, "p", `${label}: ${display}`, "mt-2 text-xs text-slate-300");
                    });
                }
                root.append(card);
            });
            appendText(root, "p", report.disclaimer, "text-xs leading-5 text-slate-500 sm:col-span-2");
        } catch (error) {
            showToast(error.message, true);
        } finally {
            button.disabled = false;
            button.textContent = "Run Full Financial Analysis";
        }
    });

    document.getElementById("life-plan-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const payload = Object.fromEntries(values.entries());
        for (const key of ["target_amount", "current_savings", "months"]) payload[key] = Number(payload[key]);
        try {
            const plan = await api("/api/premium/life-planner", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const output = document.getElementById("life-plan-result");
            output.replaceChildren();
            appendText(output, "p", `${plan.name}: oyiga ${formatMoney(plan.monthly_savings_required)} jamg'arish kerak.`, "font-semibold text-emerald-200");
            appendText(output, "p", `Maqsadgacha ${formatMoney(plan.gap)} qoldi · ${plan.months} oy`, "mt-1 text-xs text-slate-400");
            appendText(output, "p", `Muqobil: oyiga ${formatMoney(plan.alternatives[0].monthly_savings)} bilan taxminan ${plan.alternatives[0].estimated_months} oy; ${formatMoney(plan.alternatives[1].monthly_savings)} bilan ${plan.alternatives[1].estimated_months} oy.`, "mt-2 text-xs text-slate-400");
            appendText(output, "p", "Bu hisob reja taklifi, maqsad hisobingizga avtomatik qo'shilmadi.", "mt-2 text-[11px] text-slate-500");
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("decision-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const result = await (async () => {
            try {
                return await api("/api/premium/decision-lab", {
                    method: "POST",
                    body: JSON.stringify({
                        target_amount: Number(values.get("target_amount")),
                        current_savings: Number(values.get("current_savings")),
                        monthly_income: Number(values.get("monthly_income")),
                        monthly_expenses: Number(values.get("monthly_expenses")),
                        scenarios: [
                            { name: "A ssenariy", monthly_savings: Number(values.get("savings_a")) },
                            { name: "B ssenariy", monthly_savings: Number(values.get("savings_b")) }
                        ]
                    })
                });
            } catch (error) {
                showToast(error.message, true);
                return null;
            }
        })();
        if (!result) return;
        const root = document.getElementById("decision-result");
        root.replaceChildren();
        result.scenarios.forEach((scenario) => {
            const card = document.createElement("div");
            card.className = "rounded-xl border border-cyan-400/10 bg-cyan-500/[.05] p-3";
            appendText(card, "h3", scenario.name, "font-semibold text-cyan-100");
            appendText(card, "p", `12 oyda: ${formatMoney(scenario.estimated_savings_12_months)}`, "mt-2 text-xs text-slate-300");
            const goalTiming = scenario.months_to_goal === null
                ? "Oylik jamg'arma 0: maqsad muddati hisoblanmaydi"
                : scenario.months_to_goal === 0
                    ? "Maqsadga hozir yetilgan"
                    : `Maqsadga ${scenario.months_to_goal} oyda yetadi`;
            appendText(card, "p", goalTiming, "mt-1 text-xs text-slate-300");
            appendText(card, "p", `Byudjetdan keyin qoladi: ${formatMoney(scenario.monthly_budget_remaining)}`, `mt-1 text-xs ${scenario.within_current_surplus ? "text-emerald-300" : "text-rose-300"}`);
            root.append(card);
        });
        appendText(root, "p", `Oylik jamg'arma farqi: ${formatMoney(result.monthly_difference)}. ${result.disclaimer}`, "text-xs leading-5 text-slate-500 sm:col-span-2");
    });

    let pendingImport = [];
    document.getElementById("document-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = new FormData(event.currentTarget).get("file");
        const data = new FormData();
        data.append("file", file);
        try {
            const result = await api("/api/premium/documents/preview", { method: "POST", body: data });
            pendingImport = result.preview;
            const root = document.getElementById("document-results");
            root.replaceChildren();
            appendText(root, "p", `Topildi: ${result.accepted_count} qator. ${result.note}`, "text-xs leading-5 text-amber-200");
            if (result.extracted_text) {
                const extracted = document.createElement("pre");
                extracted.className = "max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300";
                extracted.textContent = result.extracted_text;
                root.append(extracted);
                appendText(root, "p", "Chek rasmlaridan matn ajratildi, ammo OCR natijasi avtomatik operatsiyaga aylantirilmadi. Matnni tekshirib, tasdiqlangan yozuvlarni Operatsiyalar bo'limida kiriting.", "text-xs leading-5 text-slate-400");
            }
            const table = document.createElement("div");
            table.className = "max-h-56 overflow-auto rounded-lg border border-white/10";
            const tableEl = document.createElement("table");
            tableEl.className = "w-full text-left text-xs";
            result.preview.slice(0, 30).forEach((item, index) => {
                const row = tableEl.insertRow();
                [String(index + 1), item.type, item.category, formatMoney(item.amount), formatDate(item.date)].forEach((value) => {
                    const cell = row.insertCell();
                    cell.className = "border-b border-white/[.05] px-2 py-2 text-slate-300";
                    cell.textContent = value;
                });
            });
            table.append(tableEl);
            root.append(table);
            if (result.errors.length) appendText(root, "p", `${result.errors.length} qator xatosi: import qilinmaydi. Birinchi xato — ${result.errors[0].row}-qator: ${result.errors[0].error}`, "text-xs text-rose-300");
            if (pendingImport.length) {
                const confirm = document.createElement("button");
                confirm.type = "button";
                confirm.className = "action-button rounded-lg bg-emerald-600/80 px-4 py-2.5 text-sm font-semibold";
                confirm.textContent = `${pendingImport.length} ta yozuvni import qilish`;
                confirm.addEventListener("click", async () => {
                    if (!window.confirm(`${pendingImport.length} ta operatsiyani import qilasizmi?`)) return;
                    try {
                        const imported = await api("/api/premium/documents/import", {
                            method: "POST",
                            body: JSON.stringify({ transactions: pendingImport })
                        });
                        showToast(`${imported.imported_count} ta operatsiya import qilindi.`);
                        pendingImport = [];
                        root.replaceChildren();
                        await loadDashboard();
                    } catch (error) {
                        showToast(error.message, true);
                    }
                });
                root.append(confirm);
            }
        } catch (error) {
            pendingImport = [];
            showToast(error.message, true);
        }
    });

    async function loadMemory() {
        const data = await api("/api/premium/memory");
        const checkbox = document.getElementById("memory-enabled");
        checkbox.checked = data.enabled;
        document.getElementById("memory-form").classList.toggle("opacity-50", !data.enabled);
        document.getElementById("memory-form").querySelector("button").disabled = !data.enabled;
        const root = document.getElementById("memory-list");
        root.replaceChildren();
        if (!data.enabled) {
            appendText(root, "p", "Xotira o'chiq. Oldingi yozuvlar o'chirilgan.", "text-xs text-slate-500");
            return;
        }
        if (!data.memories.length) appendText(root, "p", "Hali saqlangan xotira yo'q.", "text-xs text-slate-500");
        data.memories.forEach((memory) => appendText(root, "p", memory.content, "rounded-lg border border-white/[.06] bg-white/[.025] p-3 text-xs"));
    }

    document.getElementById("memory-enabled").addEventListener("change", async (event) => {
        const enabled = event.currentTarget.checked;
        if (!enabled && !window.confirm("O'chirilsa, saqlangan barcha moliyaviy xotiralar ham o'chadi. Davom etasizmi?")) {
            event.currentTarget.checked = true;
            return;
        }
        try {
            await api("/api/premium/memory", { method: "PUT", body: JSON.stringify({ enabled }) });
            await loadMemory();
            showToast(enabled ? "Financial Memory yoqildi." : "Xotira o'chirildi va tozalandi.");
        } catch (error) {
            event.currentTarget.checked = !enabled;
            showToast(error.message, true);
        }
    });

    document.getElementById("memory-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.content;
        try {
            await api("/api/premium/memory", { method: "POST", body: JSON.stringify({ content: input.value.trim() }) });
            input.value = "";
            showToast("Xotiraga saqlandi.");
            await loadMemory();
        } catch (error) {
            showToast(error.message, true);
        }
    });
    document.getElementById("memory-refresh").addEventListener("click", () => loadMemory().catch((error) => showToast(error.message, true)));
    document.getElementById("memory-clear").addEventListener("click", async () => {
        if (!window.confirm("Barcha moliyaviy xotiralarni butunlay o'chirasizmi?")) return;
        try {
            await api("/api/premium/memory", { method: "DELETE" });
            await loadMemory();
            showToast("Barcha xotiralar tozalandi.");
        } catch (error) {
            showToast(error.message, true);
        }
    });

    document.getElementById("finance-search-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = new FormData(event.currentTarget).get("query");
        try {
            const result = await api("/api/premium/search", {
                method: "POST",
                body: JSON.stringify({ query })
            });
            const root = document.getElementById("finance-search-results");
            root.replaceChildren();
            const count = result.transactions.length + result.goals.length + result.budgets.length;
            appendText(root, "p", `${count} ta natija`, "text-xs text-indigo-200");
            result.transactions.forEach((item) => appendText(root, "p", `${formatDate(item.date)} · ${item.category} · ${formatMoney(item.amount)}`, "mt-2 text-xs text-slate-300"));
            result.goals.forEach((item) => appendText(root, "p", `Maqsad: ${item.name}`, "mt-2 text-xs text-emerald-200"));
            result.budgets.forEach((item) => appendText(root, "p", `Byudjet: ${item.category} · ${monthNames[item.month - 1]} ${item.year}`, "mt-2 text-xs text-cyan-200"));
            if (!count) appendText(root, "p", "Mos ma'lumot topilmadi.", "mt-2 text-xs text-slate-500");
        } catch (error) {
            showToast(error.message, true);
        }
    });

    async function loadFinancialReport() {
        const days = document.getElementById("report-days").value;
        const report = await api(`/api/premium/report?days=${days}`);
        const root = document.getElementById("report-results");
        root.replaceChildren();
        appendText(root, "p", `${report.period_days} kunlik hisobot · ${report.transaction_count} operatsiya`, "font-semibold text-white");
        appendText(root, "p", `Daromad: ${formatMoney(report.income)} · Xarajat: ${formatMoney(report.expenses)} · Sof: ${formatMoney(report.net)}`, "mt-2 text-xs text-slate-300");
        report.categories.slice(0, 5).forEach((item) => appendText(root, "p", `${item.category}: ${formatMoney(item.amount)}`, "mt-1 text-xs text-slate-400"));
        const csvRows = [["Kategoriya", "Summa"], ...report.categories.map((item) => [item.category, String(item.amount)])];
        const csv = csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.className = "mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5";
        exportButton.textContent = "CSV hisobotni yuklab olish";
        exportButton.addEventListener("click", () => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            link.download = `moliyaviy-hisobot-${report.period_days}-kun.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
        });
        root.append(exportButton);
    }
    document.getElementById("report-run").addEventListener("click", () => loadFinancialReport().catch((error) => showToast(error.message, true)));

    async function initialize() {
        if (!token()) {
            window.location.replace("/login");
            return;
        }
        try {
            const user = await api("/api/auth/me");
            const name = user.full_name || user.username;
            document.getElementById("user-name").textContent = name;
            document.getElementById("welcome-name").textContent = name;
            populateBudgetPeriod();
            if (window.lucide) window.lucide.createIcons();
            await Promise.all([loadDashboard(), loadMemory()]);
        } catch (error) {
            if (error.status === 401) {
                localStorage.removeItem("access_token");
                window.location.replace("/login");
            } else {
                showToast(error.message, true);
            }
        }
    }

    initialize();
})();
