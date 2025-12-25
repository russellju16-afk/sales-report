#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, date
from glob import glob

import pandas as pd


TOP_N = 20


def normalize_text(val):
    if val is None:
        return ''
    s = str(val).strip()
    return s


def normalize_col_key(name):
    s = normalize_text(name).lower()
    s = s.replace('（', '(').replace('）', ')')
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'[\-_/]', '', s)
    return s


def make_unique(cols):
    seen = {}
    out = []
    for c in cols:
        base = c if c else 'col'
        if base not in seen:
            seen[base] = 1
            out.append(base)
        else:
            seen[base] += 1
            out.append(f"{base}_{seen[base]}")
    return out


def merge_headers(header_df):
    rows = [list(header_df.iloc[i].values) for i in range(header_df.shape[0])]
    if len(rows) == 1:
        cols = [normalize_text(x) for x in rows[0]]
        return make_unique([c if c else f"col_{i+1}" for i, c in enumerate(cols)])

    top = [normalize_text(x) for x in rows[0]]
    sub = [normalize_text(x) for x in rows[1]]
    for i in range(len(top)):
        if not top[i] and i > 0:
            top[i] = top[i - 1]

    cols = []
    for i in range(len(top)):
        a = top[i]
        b = sub[i]
        if b and b != a:
            name = f"{a}_{b}" if a else b
        else:
            name = b or a or f"col_{i+1}"
        cols.append(name)
    return make_unique(cols)


def read_excel_with_header(path, sheet_name=0, header_row=0, header_rows=1):
    df_raw = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=object)
    header_df = df_raw.iloc[header_row:header_row + header_rows]
    data_df = df_raw.iloc[header_row + header_rows:]
    data_df = data_df.dropna(how='all')
    data_df.columns = merge_headers(header_df)
    return data_df.reset_index(drop=True)


def read_excel_guess_header(path, sheet_name=0, max_header=3):
    df_raw = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=object)
    best = None
    for header_row in range(max_header + 1):
        header_df = df_raw.iloc[header_row:header_row + 1]
        cols = merge_headers(header_df)
        if not cols:
            continue
        non_empty = sum(1 for c in cols if c and not str(c).lower().startswith('unnamed'))
        if best is None or non_empty > best[0]:
            best = (non_empty, header_row, cols)
    if best is None:
        return read_excel_with_header(path, sheet_name=sheet_name, header_row=0, header_rows=1)
    return read_excel_with_header(path, sheet_name=sheet_name, header_row=best[1], header_rows=1)


def find_column(df, patterns):
    cols = list(df.columns)
    norm_map = {col: normalize_col_key(col) for col in cols}
    for pat in patterns:
        keys = pat if isinstance(pat, (list, tuple)) else [pat]
        keys = [normalize_col_key(k) for k in keys]
        for col in cols:
            ncol = norm_map[col]
            if all(k in ncol for k in keys):
                return col
    return None


def safe_number(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            return None
        return float(val)
    try:
        n = float(str(val).replace(',', '').strip())
    except Exception:
        return None
    if math.isnan(n) or math.isinf(n):
        return None
    return n


def safe_div(num, denom):
    n = safe_number(num)
    d = safe_number(denom)
    if n is None or d is None or d == 0:
        return None
    return n / d


def parse_date_series(series):
    dt = pd.to_datetime(series, errors='coerce')
    return dt


def month_range(start_date, end_date):
    if not start_date or not end_date:
        return []
    start = datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.strptime(end_date, '%Y-%m-%d').date()
    months = []
    cur = date(start.year, start.month, 1)
    while cur <= end:
        months.append(cur.strftime('%Y-%m'))
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return months


def align_monthly_series(months, values_by_month):
    return [safe_number(values_by_month.get(m, 0)) for m in months]


def build_monthly_sum(df, date_col, amount_col, start, end, abs_value=False):
    if date_col is None or amount_col is None:
        return [], []
    dates = parse_date_series(df[date_col])
    amt = pd.to_numeric(df[amount_col], errors='coerce').fillna(0)
    if abs_value:
        amt = amt.abs()
    months = dates.dt.to_period('M').astype(str)
    grouped = amt.groupby(months).sum().to_dict()
    out_months = month_range(start, end) or sorted(grouped.keys())
    return out_months, align_monthly_series(out_months, grouped)


def classify_segment(val):
    if val is None:
        return None
    s = str(val)
    if '非门' in s:
        return 'nonstore'
    if '门店' in s:
        return 'store'
    if '店' in s and '门' in s:
        return 'store'
    return None


def detect_segment_column(df):
    return find_column(df, [
        ['门店'],
        ['渠道'],
        ['客户类型'],
        ['业务类型'],
        ['销售类型'],
        ['维度']
    ])


def build_top_list(rows, key, top_n=TOP_N):
    rows = [r for r in rows if safe_number(r.get(key)) not in (None, 0)]
    rows.sort(key=lambda r: safe_number(r.get(key)) or 0, reverse=True)
    return rows[:top_n]


def build_last_date_map(bank_df, date_col, name_col, amount_col, direction='in'):
    if date_col is None or name_col is None or amount_col is None:
        return {}
    dates = parse_date_series(bank_df[date_col])
    amounts = pd.to_numeric(bank_df[amount_col], errors='coerce').fillna(0)
    names = bank_df[name_col].fillna('')
    records = {}
    for d, name, amt in zip(dates, names, amounts):
        if pd.isna(d):
            continue
        val = amt
        if direction == 'out' and amt < 0:
            val = -amt
        if val <= 0:
            continue
        key = str(name).strip()
        if not key:
            continue
        cur = records.get(key)
        if cur is None or d > cur:
            records[key] = d
    return records


def match_last_date(name, last_date_map):
    if not name:
        return None
    s = str(name)
    best = None
    for key, dt in last_date_map.items():
        if key and (key in s or s in key):
            if best is None or dt > best:
                best = dt
    return best


def build_ar_segments(df_ar, df_bank, sales_trend, period_start, period_end):
    seg_col = detect_segment_column(df_ar) if df_ar is not None else None
    cust_col = find_column(df_ar, [['客户名称'], ['客户'], ['往来单位'], ['单位名称']])
    cust_code_col = find_column(df_ar, [['客户编码'], ['客户代码'], ['编码']])
    ending_net_col = find_column(df_ar, [['期末', '应收净额'], ['期末', '应收余额'], ['期末', '应收']])
    ending_sales_col = find_column(df_ar, [['期末', '销售应收'], ['期末', '应收销售']])
    ending_other_col = find_column(df_ar, [['期末', '其他应收'], ['其他应收']])
    ending_pre_col = find_column(df_ar, [['期末', '预收'], ['预收']])
    opening_col = find_column(df_ar, [['期初', '应收'], ['期初', '应收净额'], ['期初', '应收余额']])

    bank_date_col = find_column(df_bank, [['日期'], ['记账日期'], ['业务日期']])
    bank_name_col = find_column(df_bank, [['对方单位'], ['对方名称'], ['往来单位'], ['对方']])
    bank_income_col = find_column(df_bank, [['收入', '本位币'], ['收入金额'], ['收款']])

    last_receipt_map = build_last_date_map(df_bank, bank_date_col, bank_name_col, bank_income_col, direction='in') if df_bank is not None else {}

    rows = []
    if df_ar is not None and cust_col is not None:
        for _, r in df_ar.iterrows():
            customer = normalize_text(r.get(cust_col))
            if not customer:
                continue
            ending_net = safe_number(r.get(ending_net_col))
            ending_sales = safe_number(r.get(ending_sales_col))
            ending_other = safe_number(r.get(ending_other_col))
            ending_pre = safe_number(r.get(ending_pre_col))
            ending_balance = ending_net if ending_net is not None else (ending_sales if ending_sales is not None else None)
            opening = safe_number(r.get(opening_col)) if opening_col else None
            change = (ending_balance - opening) if ending_balance is not None and opening is not None else None
            seg = classify_segment(r.get(seg_col)) if seg_col else None
            last_dt = match_last_date(customer, last_receipt_map)
            last_receipt = last_dt.strftime('%Y-%m-%d') if last_dt is not None else None
            days_since = None
            if last_dt is not None and period_end:
                pe = datetime.strptime(period_end, '%Y-%m-%d')
                days_since = (pe.date() - last_dt.date()).days

            row = {
                'customer': customer,
                'customer_code': normalize_text(r.get(cust_code_col)) if cust_code_col else None,
                'ending_net_ar': ending_net,
                'ending_sales_ar': ending_sales,
                'ending_other_ar': ending_other,
                'ending_pre_receipt': ending_pre,
                'ending_balance': ending_balance,
                'change': change,
                'last_receipt': last_receipt,
                'days_since_last_receipt': days_since,
                'segment': seg
            }
            rows.append(row)

    def build_segment(seg_key):
        seg_rows = [r for r in rows if r.get('segment') == seg_key] if seg_col else rows
        top_customers = build_top_list(seg_rows, 'ending_balance')
        top_other = build_top_list(seg_rows, 'ending_other_ar')
        kpi = {
            'ending_net_ar': sum((safe_number(r.get('ending_net_ar')) or 0) for r in seg_rows) if seg_rows else None,
            'ending_sales_ar': sum((safe_number(r.get('ending_sales_ar')) or 0) for r in seg_rows) if seg_rows else None,
            'ending_other_ar': sum((safe_number(r.get('ending_other_ar')) or 0) for r in seg_rows) if seg_rows else None,
            'ending_pre_receipt': sum((safe_number(r.get('ending_pre_receipt')) or 0) for r in seg_rows) if seg_rows else None,
        }
        trend = {
            'months': sales_trend.get(seg_key, {}).get('months', []),
            'sales_invoiced': sales_trend.get(seg_key, {}).get('sales_invoiced', []),
            'cash_receipts': sales_trend.get(seg_key, {}).get('cash_receipts', [])
        }
        return {
            'kpi': kpi,
            'trend': trend,
            'top_customers': top_customers,
            'top_other_ar_customers': top_other
        }

    segments = {
        'total': build_segment('total'),
        'store': build_segment('store'),
        'nonstore': build_segment('nonstore')
    }

    return segments, bool(seg_col)


def build_ap(df_ap, df_bank, po_trend, period_start, period_end):
    sup_col = find_column(df_ap, [['供应商'], ['往来单位'], ['单位名称']])
    ending_net_col = find_column(df_ap, [['期末', '应付净额'], ['期末', '应付余额'], ['期末', '应付']])
    ending_purchase_col = find_column(df_ap, [['期末', '采购应付'], ['采购应付']])
    ending_other_col = find_column(df_ap, [['期末', '其他应付'], ['其他应付']])
    ending_prepay_col = find_column(df_ap, [['期末', '预付'], ['预付']])
    opening_col = find_column(df_ap, [['期初', '应付'], ['期初', '应付净额'], ['期初', '应付余额']])

    bank_date_col = find_column(df_bank, [['日期'], ['记账日期'], ['业务日期']])
    bank_name_col = find_column(df_bank, [['对方单位'], ['对方名称'], ['往来单位'], ['对方']])
    bank_out_col = find_column(df_bank, [['支出', '本位币'], ['支出金额'], ['付款']])

    last_payment_map = build_last_date_map(df_bank, bank_date_col, bank_name_col, bank_out_col, direction='out') if df_bank is not None else {}

    rows = []
    if df_ap is not None and sup_col is not None:
        for _, r in df_ap.iterrows():
            supplier = normalize_text(r.get(sup_col))
            if not supplier:
                continue
            ending_net = safe_number(r.get(ending_net_col))
            ending_purchase = safe_number(r.get(ending_purchase_col))
            ending_other = safe_number(r.get(ending_other_col))
            ending_prepay = safe_number(r.get(ending_prepay_col))
            ending_balance = ending_net if ending_net is not None else (ending_purchase if ending_purchase is not None else None)
            opening = safe_number(r.get(opening_col)) if opening_col else None
            last_dt = match_last_date(supplier, last_payment_map)
            last_payment = last_dt.strftime('%Y-%m-%d') if last_dt is not None else None
            days_since = None
            if last_dt is not None and period_end:
                pe = datetime.strptime(period_end, '%Y-%m-%d')
                days_since = (pe.date() - last_dt.date()).days
            row = {
                'supplier': supplier,
                'ending_net_ap': ending_net,
                'ending_purchase_ap': ending_purchase,
                'ending_other_ap': ending_other,
                'ending_prepay': ending_prepay,
                'purchase_ap_balance': ending_purchase,
                'other_ap_balance': ending_other,
                'prepay_balance': ending_prepay,
                'ending_balance': ending_balance,
                'last_payment': last_payment,
                'days_since_last_payment': days_since,
                'change': (ending_balance - opening) if ending_balance is not None and opening is not None else None
            }
            rows.append(row)

    top_suppliers = build_top_list(rows, 'ending_balance')
    top_other = build_top_list(rows, 'ending_other_ap')

    trend = {
        'months': po_trend.get('months', []),
        'purchases_invoiced': po_trend.get('purchases_invoiced', []),
        'cash_payments': po_trend.get('cash_payments', [])
    }

    kpi = {
        'ending_net_ap': sum((safe_number(r.get('ending_net_ap')) or 0) for r in rows) if rows else None,
        'ending_purchase_ap': sum((safe_number(r.get('ending_purchase_ap')) or 0) for r in rows) if rows else None,
        'ending_other_ap': sum((safe_number(r.get('ending_other_ap')) or 0) for r in rows) if rows else None,
        'ending_prepay': sum((safe_number(r.get('ending_prepay')) or 0) for r in rows) if rows else None,
    }

    return {
        'kpi': kpi,
        'trend': trend,
        'top_suppliers': top_suppliers,
        'top_other_ap_suppliers': top_other
    }


def build_bank(df_bank, period_start, period_end):
    date_col = find_column(df_bank, [['日期'], ['记账日期'], ['业务日期']])
    income_col = find_column(df_bank, [['收入', '本位币'], ['收入金额'], ['收款']])
    out_col = find_column(df_bank, [['支出', '本位币'], ['支出金额'], ['付款']])
    type_col = find_column(df_bank, [['类型'], ['业务类型'], ['摘要'], ['用途']])

    months, cash_in = build_monthly_sum(df_bank, date_col, income_col, period_start, period_end)
    _, cash_out = build_monthly_sum(df_bank, date_col, out_col, period_start, period_end, abs_value=True)

    net_cash = []
    cum_cash = []
    total = 0
    for cin, cout in zip(cash_in, cash_out):
        cin = safe_number(cin) or 0
        cout = safe_number(cout) or 0
        net = cin - cout
        total += net
        net_cash.append(net)
        cum_cash.append(total)

    by_type = []
    if type_col and income_col and out_col:
        df_bank = df_bank.copy()
        df_bank['_cash_in'] = pd.to_numeric(df_bank[income_col], errors='coerce').fillna(0)
        df_bank['_cash_out'] = pd.to_numeric(df_bank[out_col], errors='coerce').fillna(0).abs()
        grouped = df_bank.groupby(df_bank[type_col].fillna('未知'))
        for name, g in grouped:
            by_type.append({
                'type': str(name),
                'cash_in': safe_number(g['_cash_in'].sum()),
                'cash_out': safe_number(g['_cash_out'].sum()),
                'count': int(len(g))
            })

    kpi = {
        'period_cash_in': sum((safe_number(x) or 0) for x in cash_in) if cash_in else None,
        'period_cash_out': sum((safe_number(x) or 0) for x in cash_out) if cash_out else None,
        'period_net_cash': sum((safe_number(x) or 0) for x in net_cash) if net_cash else None,
        'diff_receipts': 0,
        'diff_payments': 0
    }

    trend = {
        'months': months,
        'cash_in': cash_in,
        'cash_out': cash_out,
        'net_cash': net_cash,
        'cum_net_cash': cum_cash
    }

    return {
        'kpi': kpi,
        'trend': trend,
        'by_type': by_type
    }


def build_inventory(df_inv, period_start, period_end):
    date_col = find_column(df_inv, [['日期'], ['业务日期'], ['单据日期']])
    inbound_col = find_column(df_inv, [['入库', '成本'], ['入库', '金额'], ['采购入库']])
    outbound_col = find_column(df_inv, [['出库', '成本'], ['出库', '金额'], ['销售出库']])
    ending_col = find_column(df_inv, [['期末', '库存成本'], ['期末', '库存'], ['结存', '成本']])
    sku_col = find_column(df_inv, [['SKU'], ['商品编码'], ['物料编码'], ['货号']])

    months, purchases_in = build_monthly_sum(df_inv, date_col, inbound_col, period_start, period_end)
    _, cogs = build_monthly_sum(df_inv, date_col, outbound_col, period_start, period_end)

    ending_inventory = []
    if date_col and ending_col:
        df_inv = df_inv.copy()
        df_inv['_date'] = parse_date_series(df_inv[date_col])
        df_inv['_month'] = df_inv['_date'].dt.to_period('M').astype(str)
        df_inv['_ending'] = pd.to_numeric(df_inv[ending_col], errors='coerce')
        if sku_col:
            df_inv = df_inv.sort_values('_date')
            last_per_sku = df_inv.groupby(['_month', df_inv[sku_col].fillna('')])['_ending'].last().reset_index()
            grouped = last_per_sku.groupby('_month')['_ending'].sum().to_dict()
        else:
            df_inv = df_inv.sort_values('_date')
            grouped = df_inv.groupby('_month')['_ending'].last().to_dict()
        ending_inventory = align_monthly_series(months, grouped)

    inventory_change = []
    for i, val in enumerate(ending_inventory):
        if i == 0 or val is None:
            inventory_change.append(None if val is None else val - (ending_inventory[i - 1] if i > 0 else 0))
        else:
            prev = ending_inventory[i - 1] or 0
            inventory_change.append(val - prev)

    ending_val = ending_inventory[-1] if ending_inventory else None
    avg_inv = None
    if ending_inventory:
        opening = ending_inventory[0]
        if opening is not None and ending_val is not None:
            avg_inv = (opening + ending_val) / 2
        else:
            avg_inv = ending_val

    kpi = {
        'ending_inventory': ending_val,
        'avg_inventory': avg_inv,
        'period_cogs': sum((safe_number(x) or 0) for x in cogs) if cogs else None,
        'dio_days_est': None
    }

    trend = {
        'months': months,
        'purchases_in': purchases_in,
        'cogs': cogs,
        'ending_inventory': ending_inventory,
        'inventory_change': inventory_change
    }

    return {
        'kpi': kpi,
        'trend': trend
    }


def build_po(df_po, period_start, period_end):
    date_col = find_column(df_po, [['日期'], ['单据日期'], ['入库日期']])
    supplier_col = find_column(df_po, [['供应商'], ['往来单位'], ['单位名称']])
    sku_col = find_column(df_po, [['SKU'], ['商品编码'], ['物料编码'], ['货号']])
    product_col = find_column(df_po, [['品名'], ['商品名称'], ['物料名称'], ['商品']])
    qty_col = find_column(df_po, [['数量'], ['入库数量']])
    amount_col = find_column(df_po, [['金额'], ['入库金额'], ['含税金额']])

    if df_po is not None:
        fill_cols = [c for c in [date_col, supplier_col, sku_col, product_col] if c]
        if fill_cols:
            df_po[fill_cols] = df_po[fill_cols].ffill()

    months, inbound_amount = build_monthly_sum(df_po, date_col, amount_col, period_start, period_end)

    top_suppliers = []
    if supplier_col and amount_col:
        df_po = df_po.copy()
        df_po['_amount'] = pd.to_numeric(df_po[amount_col], errors='coerce').fillna(0)
        grouped = df_po.groupby(df_po[supplier_col].fillna('未知'))['_amount'].sum().sort_values(ascending=False)
        for name, val in grouped.head(TOP_N).items():
            top_suppliers.append({'supplier': str(name), 'amount': safe_number(val)})

    price_trends = []
    if sku_col and qty_col and amount_col:
        df_po = df_po.copy()
        df_po['_date'] = parse_date_series(df_po[date_col]) if date_col else pd.NaT
        df_po['_month'] = df_po['_date'].dt.to_period('M').astype(str)
        df_po['_qty'] = pd.to_numeric(df_po[qty_col], errors='coerce').fillna(0)
        df_po['_amount'] = pd.to_numeric(df_po[amount_col], errors='coerce').fillna(0)
        df_po['_sku'] = df_po[sku_col].fillna('')
        df_po['_product'] = df_po[product_col].fillna('') if product_col else ''

        grouped = df_po.groupby(['_sku', '_product', '_month'])
        agg = grouped.agg({'_qty': 'sum', '_amount': 'sum'}).reset_index()

        for (sku, prod), g in agg.groupby(['_sku', '_product']):
            if not str(sku).strip() and not str(prod).strip():
                continue
            g = g.sort_values('_month')
            mlist = g['_month'].tolist()
            avg_cost = []
            for _, row in g.iterrows():
                avg = safe_div(row['_amount'], row['_qty'])
                avg_cost.append(avg)
            total_amount = g['_amount'].sum()
            price_trends.append({
                'sku': str(sku),
                'product': str(prod),
                'months': mlist,
                'avg_unit_cost': avg_cost,
                'amount': safe_number(total_amount)
            })

    trend = {
        'months': months,
        'inbound_amount': inbound_amount
    }

    return {
        'trend': trend,
        'top_suppliers': top_suppliers,
        'price_trends': price_trends
    }


def compute_sales_trend(df_sales, df_bank, period_start, period_end):
    date_col = find_column(df_sales, [['日期'], ['开票日期'], ['单据日期'], ['业务日期']])
    sales_col = find_column(df_sales, [['价税合计'], ['销售额'], ['开票金额'], ['收入']])

    bank_date_col = find_column(df_bank, [['日期'], ['记账日期'], ['业务日期']])
    bank_income_col = find_column(df_bank, [['收入', '本位币'], ['收入金额'], ['收款']])

    sales_months, sales_invoiced = build_monthly_sum(df_sales, date_col, sales_col, period_start, period_end)
    cash_months, cash_receipts = build_monthly_sum(df_bank, bank_date_col, bank_income_col, period_start, period_end)

    months = month_range(period_start, period_end) or sorted(set(sales_months + cash_months))
    sales_map = dict(zip(sales_months, sales_invoiced))
    cash_map = dict(zip(cash_months, cash_receipts))

    base = {
        'months': months,
        'sales_invoiced': align_monthly_series(months, sales_map),
        'cash_receipts': align_monthly_series(months, cash_map)
    }

    return {
        'total': base,
        'store': base,
        'nonstore': base
    }


def build_wc(ar_segments, ap, inventory, period_start, period_end, sales_total, purchases_total):
    days = None
    if period_start and period_end:
        ps = datetime.strptime(period_start, '%Y-%m-%d')
        pe = datetime.strptime(period_end, '%Y-%m-%d')
        days = (pe.date() - ps.date()).days + 1

    ar_kpi = ar_segments.get('total', {}).get('kpi', {})
    ap_kpi = ap.get('kpi', {}) if ap else {}
    inv_kpi = inventory.get('kpi', {}) if inventory else {}

    ending_sales_ar = ar_kpi.get('ending_sales_ar')
    ending_purchase_ap = ap_kpi.get('ending_purchase_ap')
    avg_inventory = inv_kpi.get('avg_inventory') or inv_kpi.get('ending_inventory')
    period_cogs = inv_kpi.get('period_cogs')

    dso = safe_div(ending_sales_ar, safe_div(sales_total, days) if days else None)
    dpo = safe_div(ending_purchase_ap, safe_div(purchases_total, days) if days else None)
    dio = safe_div(avg_inventory, safe_div(period_cogs, days) if days else None)
    ccc = None
    if dso is not None and dio is not None and dpo is not None:
        ccc = dso + dio - dpo

    trade_wc = None
    if ending_sales_ar is not None and avg_inventory is not None and ending_purchase_ap is not None:
        trade_wc = ending_sales_ar + avg_inventory - ending_purchase_ap

    kpi = {
        'dso_days_est': dso,
        'dpo_days_est': dpo,
        'dio_days_est': dio,
        'ccc_days_est': ccc,
        'ccc_days': ccc,
        'working_capital': trade_wc,
        'trade_working_capital': trade_wc,
        'sales_ar_end': ending_sales_ar,
        'trade_ap_end': ending_purchase_ap,
        'inventory_end': inv_kpi.get('ending_inventory')
    }

    bridge = {
        'ar_delta': None,
        'ap_delta': None,
        'inv_delta': None,
        'cash_delta': None
    }

    return {
        'kpi': kpi,
        'bridge': bridge
    }


def build_notes(meta, ar_segments, ap, bank, inventory, wc, period_end):
    notes = []
    meta_notes = []

    ar_kpi = ar_segments.get('total', {}).get('kpi', {})
    ap_kpi = ap.get('kpi', {}) if ap else {}
    bank_kpi = bank.get('kpi', {}) if bank else {}
    inv_kpi = inventory.get('kpi', {}) if inventory else {}

    ending_net_ar = ar_kpi.get('ending_net_ar')
    ending_net_ap = ap_kpi.get('ending_net_ap')
    net_cash = bank_kpi.get('period_net_cash')
    dio = wc.get('kpi', {}).get('dio_days_est') if wc else None

    top_customers = ar_segments.get('total', {}).get('top_customers', [])
    top_suppliers = ap.get('top_suppliers', []) if ap else []

    top1_ratio_ar = None
    if top_customers and ending_net_ar:
        top1 = safe_number(top_customers[0].get('ending_balance')) or 0
        top1_ratio_ar = safe_div(top1, ending_net_ar) * 100 if ending_net_ar else None

    top1_ratio_ap = None
    if top_suppliers and ending_net_ap:
        top1 = safe_number(top_suppliers[0].get('ending_balance')) or 0
        top1_ratio_ap = safe_div(top1, ending_net_ap) * 100 if ending_net_ap else None

    meta_notes.append(
        f"【AR】应收净额 {fmt_wan(ending_net_ar)}，Top1占比 {fmt_pct(top1_ratio_ar)}（ar.segments.total.kpi.ending_net_ar/top1）｜动作：对Top3客户设回款承诺日，本周复盘"
    )

    meta_notes.append(
        f"【AP】应付净额 {fmt_wan(ending_net_ap)}，Top1占比 {fmt_pct(top1_ratio_ap)}（ap.kpi.ending_net_ap/top1）｜动作：先完成对账与重分类，再排付款优先级"
    )

    meta_notes.append(
        f"【BANK】期间净现金流 {fmt_wan(net_cash)}（bank.kpi.period_net_cash）｜动作：滚动14天收支计划，压缩非刚性支出"
    )

    meta_notes.append(
        f"【INVENTORY】期末库存 {fmt_wan(inv_kpi.get('ending_inventory'))}，DIO≈{fmt_days(dio)}天（inventory.kpi）｜动作：关注慢动库存与周转天数"
    )

    meta['notes'] = meta_notes[:6]

    notes.append(build_structured_note(
        'AR_TOP', 'AR', severity_from_ratio(top1_ratio_ar),
        '应收集中度',
        f"应收净额 {fmt_wan(ending_net_ar)}，Top1占比 {fmt_pct(top1_ratio_ar)}",
        '对Top3客户设回款承诺日，本周复盘',
        '财务', period_end,
        [{'metric':'ar.segments.total.kpi.ending_net_ar','value':ending_net_ar,'display':fmt_wan(ending_net_ar)}]
    ))

    notes.append(build_structured_note(
        'AP_TOP', 'AP', severity_from_ratio(top1_ratio_ap),
        '应付集中度',
        f"应付净额 {fmt_wan(ending_net_ap)}，Top1占比 {fmt_pct(top1_ratio_ap)}",
        '完成对账重分类后再排付款优先级',
        '财务', period_end,
        [{'metric':'ap.kpi.ending_net_ap','value':ending_net_ap,'display':fmt_wan(ending_net_ap)}]
    ))

    notes.append(build_structured_note(
        'BANK_NET', 'BANK', severity_from_cash(net_cash),
        '净现金流',
        f"期间净现金流 {fmt_wan(net_cash)}",
        '滚动14天收支计划，压缩非刚性支出',
        '财务', period_end,
        [{'metric':'bank.kpi.period_net_cash','value':net_cash,'display':fmt_wan(net_cash)}]
    ))

    return meta_notes[:6], notes


def fmt_wan(val):
    n = safe_number(val)
    if n is None:
        return '—'
    return f"{n/10000:.2f}万"


def fmt_pct(val):
    n = safe_number(val)
    if n is None:
        return '—'
    return f"{n:.2f}%"


def fmt_days(val):
    n = safe_number(val)
    if n is None:
        return '—'
    return f"{n:.1f}"


def severity_from_ratio(ratio):
    n = safe_number(ratio)
    if n is None:
        return 'info'
    if n >= 50:
        return 'warn'
    if n >= 30:
        return 'ok'
    return 'info'


def severity_from_cash(val):
    n = safe_number(val)
    if n is None:
        return 'info'
    return 'warn' if n < 0 else 'ok'


def build_structured_note(note_id, module, severity, title, conclusion, action, owner, due, evidence):
    return {
        'id': note_id,
        'module': module,
        'severity': severity,
        'title': title,
        'conclusion': conclusion,
        'evidence': evidence,
        'next_actions': [
            {'owner': owner, 'action': action, 'due': due if due else '7d'}
        ]
    }


def sanitize(obj):
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    return obj


def dump_json(path, obj):
    obj = sanitize(obj)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')


def ensure_dirs(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def next_version(prefix):
    pattern = re.compile(re.escape(prefix) + r"_v(\d+)\.json$")
    max_v = 0
    for p in glob(prefix + '_v*.json'):
        m = pattern.search(p)
        if m:
            max_v = max(max_v, int(m.group(1)))
    return max_v + 1


def render_bp_html(finance, period_start, period_end, template_path=None):
    title = f"财务BP报告（截至 {period_end}）" if period_end else '财务BP报告'
    meta = finance.get('meta', {})
    notes = finance.get('notes', [])

    top_notes = notes[:3] if notes else []
    actions = []
    for n in notes:
        for act in n.get('next_actions', []):
            actions.append({
                'owner': act.get('owner'),
                'action': act.get('action'),
                'due': act.get('due')
            })

    def format_note(n):
        ev = n.get('evidence', [])
        if ev:
            ev_text = '；'.join([f"{e.get('metric','')}={e.get('display','—')}" for e in ev])
        else:
            ev_text = '指标缺失'
        return f"{n.get('conclusion','')}（{ev_text}）｜动作：{n.get('next_actions',[{}])[0].get('action','') if n.get('next_actions') else ''}"

    conclusions = [format_note(n) for n in top_notes]

    ar = finance.get('ar', {})
    ar_total = ar.get('segments', {}).get('total', {})
    ap = finance.get('ap', {})
    bank = finance.get('bank', {})
    inv = finance.get('inventory', {})
    wc = finance.get('wc', {})

    ar_kpi = ar_total.get('kpi', {})
    ap_kpi = ap.get('kpi', {})
    inv_kpi = inv.get('kpi', {})
    bank_kpi = bank.get('kpi', {})
    wc_kpi = wc.get('kpi', {})

    html = f"""<!doctype html>
<html lang=\"zh-CN\">
<head>
<meta charset=\"utf-8\"/>
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>
<title>{title}</title>
<style>
body{{font-family:system-ui,-apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif;margin:0;background:#faf7f2;color:#1f2a37;}}
.header{{padding:24px 24px 10px;background:linear-gradient(180deg,#fff, #faf7f2);border-bottom:1px solid #eee;}}
h1{{margin:0;font-size:22px;}}
.sub{{color:#6b7280;margin-top:6px;font-size:13px;line-height:1.5;}}
.container{{max-width:1100px;margin:0 auto;padding:18px 24px 48px;}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}}
.card{{background:#fff;border:1px solid #eee;border-radius:14px;padding:12px 12px;box-shadow:0 1px 3px rgba(0,0,0,.03);}}
.card .k{{color:#6b7280;font-size:12px;}}
.card .v{{font-weight:700;font-size:18px;margin-top:4px;}}
.section{{margin-top:18px;background:#fff;border:1px solid #eee;border-radius:14px;padding:14px;}}
.section h2{{margin:0 0 10px;font-size:16px;}}
ul{{margin:8px 0 0 18px;}}
table{{width:100%;border-collapse:collapse;font-size:12px;}}
th,td{{border-bottom:1px solid #f0f0f0;padding:8px 6px;text-align:left;vertical-align:top;}}
.small{{color:#6b7280;font-size:12px;}}
@media(max-width:960px){{.grid{{grid-template-columns:repeat(2,1fr);}}}}
@media(max-width:520px){{.grid{{grid-template-columns:1fr;}}}}
</style>
</head>
<body>
<div class=\"header\">
  <h1>{title}</h1>
  <div class=\"sub\">期间：{period_start} ~ {period_end}。现金以银行收支明细为准；库存以商品收发明细的日末库存成本汇总。</div>
</div>

<div class=\"container\">
  <div class=\"grid\">
    <div class=\"card\"><div class=\"k\">期末应收净额</div><div class=\"v\">{fmt_wan(ar_kpi.get('ending_net_ar'))}</div><div class=\"small\">DSO≈{fmt_days(wc_kpi.get('dso_days_est'))}天</div></div>
    <div class=\"card\"><div class=\"k\">期末应付净额</div><div class=\"v\">{fmt_wan(ap_kpi.get('ending_net_ap'))}</div><div class=\"small\">采购应付 {fmt_wan(ap_kpi.get('ending_purchase_ap'))}</div></div>
    <div class=\"card\"><div class=\"k\">期末库存（成本）</div><div class=\"v\">{fmt_wan(inv_kpi.get('ending_inventory'))}</div><div class=\"small\">DIO≈{fmt_days(wc_kpi.get('dio_days_est'))}天</div></div>
    <div class=\"card\"><div class=\"k\">期间净现金流</div><div class=\"v\">{fmt_wan(bank_kpi.get('period_net_cash'))}</div><div class=\"small\">现金流入 {fmt_wan(bank_kpi.get('period_cash_in'))}</div></div>
  </div>

  <div class=\"section\">
    <h2>本期三大结论</h2>
    <ul>
      {''.join([f'<li>{c}</li>' for c in conclusions])}
    </ul>
  </div>

  <div class=\"section\">
    <h2>下一步动作清单</h2>
    <table>
      <thead><tr><th>Owner</th><th>Action</th><th>Due</th></tr></thead>
      <tbody>
        {''.join([f'<tr><td>{a.get("owner","-")}</td><td>{a.get("action","-")}</td><td>{a.get("due","-")}</td></tr>' for a in actions])}
      </tbody>
    </table>
  </div>
</div>
</body>
</html>"""

    if template_path and os.path.exists(template_path):
        tpl = open(template_path, 'r', encoding='utf-8').read()
        if '{{BP_CONTENT}}' in tpl:
            return tpl.replace('{{BP_CONTENT}}', html)
    return html


def validate_required_fields(data, rules):
    missing = []
    for path in rules:
        cur = data
        for part in path.split('.'):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                missing.append(path)
                break
    return missing


def build_publish_package(period_start, period_end, snapshots):
    pkg = {
        'PUBLISH_PACKAGE': {
            'version': 'publish_package/v1',
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'period': {'start': period_start, 'end': period_end},
            'artifacts': [
                {'path': 'data/finance_latest.json', 'content_type': 'application/json; charset=utf-8'},
                {'path': 'reports/bp_latest.html', 'content_type': 'text/html; charset=utf-8'}
            ],
            'snapshots': snapshots,
            'checks': [
                {'type': 'json_parse', 'path': 'data/finance_latest.json'},
                {'type': 'required_fields', 'path': 'data/finance_latest.json', 'rules': REQUIRED_FIELDS},
                {'type': 'no_nan_inf', 'path': 'data/finance_latest.json'}
            ],
            'commit_message': f"chore(data): update finance_latest + bp_latest for {period_end}"
        }
    }
    return pkg


REQUIRED_FIELDS = [
    'meta.period_start',
    'meta.period_end',
    'meta.generated_at',
    'meta.currency',
    'meta.unit',
    'meta.notes',
    'bp.latest_path',
    'bp.title',
    'ar.segments.total.kpi.ending_net_ar',
    'ar.segments.total.kpi.ending_sales_ar',
    'ar.segments.total.trend.months',
    'ar.segments.total.trend.sales_invoiced',
    'ar.segments.total.trend.cash_receipts',
    'ar.segments.total.top_customers',
    'ap.kpi.ending_net_ap',
    'ap.trend.months',
    'ap.trend.purchases_invoiced',
    'ap.trend.cash_payments',
    'ap.top_suppliers',
    'bank.kpi.period_cash_in',
    'bank.kpi.period_cash_out',
    'bank.kpi.period_net_cash',
    'bank.trend.months',
    'bank.trend.cash_in',
    'bank.trend.cash_out',
    'bank.trend.net_cash',
    'bank.trend.cum_net_cash',
    'bank.by_type',
    'inventory.kpi.ending_inventory',
    'inventory.kpi.avg_inventory',
    'inventory.kpi.period_cogs',
    'inventory.kpi.dio_days_est',
    'inventory.trend.months',
    'inventory.trend.purchases_in',
    'inventory.trend.cogs',
    'inventory.trend.ending_inventory',
    'po.trend.months',
    'po.trend.inbound_amount',
    'po.top_suppliers',
    'po.price_trends',
    'wc.kpi.dso_days_est',
    'wc.kpi.dpo_days_est',
    'wc.kpi.dio_days_est',
    'wc.kpi.ccc_days_est',
    'wc.kpi.trade_working_capital',
    'wc.bridge'
]


def main():
    parser = argparse.ArgumentParser(description='Build finance_latest.json + bp_latest.html + publish package.')
    parser.add_argument('--sales', required=True, help='销售利润表.xlsx')
    parser.add_argument('--ar', required=True, help='应收账款明细表.xlsx')
    parser.add_argument('--ap', required=True, help='应付账款明细表.xlsx')
    parser.add_argument('--bank', required=True, help='企业收支明细表.xlsx')
    parser.add_argument('--inv', required=True, help='商品收发明细表.xlsx')
    parser.add_argument('--po', required=True, help='采购订单.xlsx')
    parser.add_argument('--period-start', required=True, help='YYYY-MM-DD')
    parser.add_argument('--period-end', required=True, help='YYYY-MM-DD')
    parser.add_argument('--out-root', default='.', help='输出目录根路径')
    args = parser.parse_args()

    out_root = args.out_root
    period_start = args.period_start
    period_end = args.period_end

    df_sales = read_excel_guess_header(args.sales)
    df_ar = read_excel_with_header(args.ar, header_row=1, header_rows=2)
    df_ap = read_excel_with_header(args.ap, header_row=1, header_rows=2)
    df_bank = read_excel_with_header(args.bank, header_row=2, header_rows=1)
    df_inv = read_excel_with_header(args.inv, header_row=1, header_rows=2)
    df_po = read_excel_with_header(args.po, header_row=2, header_rows=1)

    sales_trend = compute_sales_trend(df_sales, df_bank, period_start, period_end)
    bank = build_bank(df_bank, period_start, period_end)
    po = build_po(df_po, period_start, period_end)

    po_trend = {
        'months': po.get('trend', {}).get('months', []),
        'purchases_invoiced': po.get('trend', {}).get('inbound_amount', []),
        'cash_payments': bank.get('trend', {}).get('cash_out', [])
    }

    ar_segments, has_seg = build_ar_segments(df_ar, df_bank, sales_trend, period_start, period_end)
    ap = build_ap(df_ap, df_bank, po_trend, period_start, period_end)
    inventory = build_inventory(df_inv, period_start, period_end)

    sales_total = sum((safe_number(x) or 0) for x in sales_trend['total']['sales_invoiced'])
    purchases_total = sum((safe_number(x) or 0) for x in po_trend['purchases_invoiced'])

    wc = build_wc(ar_segments, ap, inventory, period_start, period_end, sales_total, purchases_total)

    if inventory.get('kpi'):
        inventory['kpi']['dio_days_est'] = wc.get('kpi', {}).get('dio_days_est')

    meta = {
        'period_start': period_start,
        'period_end': period_end,
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'currency': 'CNY',
        'unit': '元',
        'notes': []
    }

    meta_notes, structured_notes = build_notes(meta, ar_segments, ap, bank, inventory, wc, period_end)
    if not has_seg:
        meta_notes.insert(0, '【SEG】除 AR 外均为总口径；segment 无法拆分，本期沿用 total。')
        meta['notes'] = meta_notes[:6]

    finance = {
        'meta': meta,
        'bp': {
            'latest_path': './reports/bp_latest.html',
            'title': f"BP报告（{period_end}）"
        },
        'ar': {
            'segments': ar_segments
        },
        'ap': ap,
        'bank': bank,
        'inventory': inventory,
        'po': po,
        'wc': wc,
        'notes': structured_notes
    }

    finance = sanitize(finance)

    finance_latest_path = os.path.join(out_root, 'data', 'finance_latest.json')
    ensure_dirs(finance_latest_path)
    dump_json(finance_latest_path, finance)

    date_tag = period_end.replace('-', '')
    fin_prefix = os.path.join(out_root, 'data', f'finance_{date_tag}')
    v = next_version(fin_prefix)
    fin_snapshot = f"{fin_prefix}_v{v}.json"
    dump_json(fin_snapshot, finance)

    bp_latest_path = os.path.join(out_root, 'reports', 'bp_latest.html')
    ensure_dirs(bp_latest_path)
    bp_html = render_bp_html(finance, period_start, period_end, template_path=bp_latest_path)
    with open(bp_latest_path, 'w', encoding='utf-8', newline='') as f:
        f.write(bp_html)

    bp_snapshot = os.path.join(out_root, 'reports', f"bp_{date_tag}.html")
    with open(bp_snapshot, 'w', encoding='utf-8', newline='') as f:
        f.write(bp_html)

    with open(finance_latest_path, 'r', encoding='utf-8') as f:
        parsed = json.load(f)

    missing = validate_required_fields(parsed, REQUIRED_FIELDS)
    top_customers_len = len(parsed.get('ar', {}).get('segments', {}).get('total', {}).get('top_customers', []))
    top_suppliers_len = len(parsed.get('ap', {}).get('top_suppliers', []))
    warn_count = sum(1 for n in parsed.get('notes', []) if n.get('severity') in ('warn', 'risk'))

    print('=== Validation Report ===')
    print('required_fields missing:', missing if missing else 'OK')
    print('json_parse: OK')
    print(f'top_customers: {top_customers_len} (top_n={TOP_N})')
    print(f'top_suppliers: {top_suppliers_len} (top_n={TOP_N})')
    print(f'meta.notes count: {len(meta_notes)} | severity>=warn: {warn_count}')

    snapshots = [
        {'from': 'data/finance_latest.json', 'to': os.path.relpath(fin_snapshot, out_root)},
        {'from': 'reports/bp_latest.html', 'to': os.path.relpath(bp_snapshot, out_root)}
    ]

    pkg = build_publish_package(period_start, period_end, snapshots)
    print('=== PUBLISH_PACKAGE ===')
    print(json.dumps(pkg, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.exit(main())
