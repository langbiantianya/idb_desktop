<script>
	import { Modal, MdButton } from '$lib/components/ui/index.js';
	import { t } from '$lib/i18n';

	/** @typedef {Object} Props
	 *  @property {boolean} open
	 *  @property {() => void} onClose
	 */

	/** @type {Props} */
	let { open, onClose } = $props();
</script>

<Modal {open} {onClose} title={$t('dg.help_title')} size="lg">
	<div class="dg-help-content">
		<!-- 内置函数详解 -->
		<h3>{$t('dg.help.builtins_title')}</h3>

		<h4>{$t('dg.help.data_write')}</h4>
		<table>
			<thead><tr><th>{$t('dg.help.func')}</th><th>{$t('dg.help.desc')}</th></tr></thead>
			<tbody>
				<tr>
					<td><code>insert(tableName, rowTable)</code></td>
					<td>{@html $t('dg.help.insert.desc')}</td>
				</tr>
				<tr>
					<td><code>lastId()</code></td>
					<td>{@html $t('dg.help.lastid.desc')}</td>
				</tr>
			</tbody>
		</table>

		<h4>{$t('dg.help.random_funcs')}</h4>
		<table>
			<thead><tr><th>{$t('dg.help.func')}</th><th>{$t('dg.help.params')}</th><th>{$t('dg.help.returns')}</th><th>{$t('dg.help.desc')}</th></tr></thead>
			<tbody>
				<tr><td><code>random_int(min, max)</code></td><td>{$t('dg.help.ri.params')}</td><td>{$t('dg.help.ri.returns')}</td><td>{$t('dg.help.ri.desc')}</td></tr>
				<tr><td><code>random_float(min, max)</code></td><td>{$t('dg.help.rf.params')}</td><td>{$t('dg.help.rf.returns')}</td><td>{$t('dg.help.rf.desc')}</td></tr>
				<tr><td><code>random_string(length)</code></td><td>{$t('dg.help.rs.params')}</td><td>{$t('dg.help.rs.returns')}</td><td>{$t('dg.help.rs.desc')}</td></tr>
				<tr><td><code>random_date(start, end)</code></td><td>{$t('dg.help.rd.params')}</td><td>{$t('dg.help.rd.returns')}</td><td>{$t('dg.help.rd.desc')}</td></tr>
				<tr><td><code>random_email()</code></td><td>{$t('dg.help.re.params')}</td><td>{$t('dg.help.re.returns')}</td><td>{@html $t('dg.help.re.desc')}</td></tr>
				<tr><td><code>random_phone()</code></td><td>{$t('dg.help.rp.params')}</td><td>{$t('dg.help.rp.returns')}</td><td>{$t('dg.help.rp.desc')}</td></tr>
				<tr><td><code>random_name()</code></td><td>{$t('dg.help.rn.params')}</td><td>{$t('dg.help.rn.returns')}</td><td>{$t('dg.help.rn.desc')}</td></tr>
				<tr><td><code>random_enum(...)</code></td><td>{$t('dg.help.renum.params')}</td><td>{$t('dg.help.renum.returns')}</td><td>{$t('dg.help.renum.desc')}</td></tr>
				<tr><td><code>random_uuid()</code></td><td>{$t('dg.help.ruuid.params')}</td><td>{$t('dg.help.ruuid.returns')}</td><td>{$t('dg.help.ruuid.desc')}</td></tr>
			</tbody>
		</table>

		<div class="dg-note">{@html $t('dg.help.loop_note')}</div>

		<h3>{$t('dg.help.examples_title')}</h3>

		<h4>{$t('dg.help.ex1.title')}</h4>
		<p>{@html $t('dg.help.ex1.desc')}</p>
		<pre><code>{"for i = 1, 100 do\n  insert('users', {\n    name = 'user_' .. i,\n    email = 'user_' .. i .. '@test.com'\n  })\nend"}</code></pre>
		<pre class="dg-json"><code>{"{\"tables\":[{\"script\":\"for i = 1, 100 do\\n  insert('users', {\\n    name = 'user_' .. i,\\n    email = 'user_' .. i .. '@test.com'\\n  })\\nend\"}]}"}</code></pre>

		<h4>{$t('dg.help.ex2.title')}</h4>
		<pre><code>{"for i = 1, 1000 do\n  insert('users', {\n    name = random_name(),\n    email = random_email(),\n    age = random_int(18, 65),\n    phone = random_phone(),\n    gender = random_enum('男', '女'),\n    status = random_enum('active', 'inactive', 'banned'),\n    bio = random_string(50),\n    created_at = random_date('2023-01-01', '2025-06-01')\n  })\nend"}</code></pre>

		<h4>{$t('dg.help.ex3.title')}</h4>
		<p>{@html $t('dg.help.ex3.desc')}</p>
		<pre class="dg-json"><code>{"{\"payload\":{\"tables\":[\n  {\"script\":\"for i = 1, 10 do\\n  insert('categories', {\\n    name = '分类_' .. i,\\n    sort_order = i\\n  })\\nend\"},\n  {\"script\":\"for i = 1, 100 do\\n  insert('products', {\\n    category_id = random_int(1, 10),\\n    name = '商品_' .. random_string(6),\\n    price = random_int(100, 99999) / 100.0,\\n    stock = random_int(0, 500)\\n  })\\nend\"}\n]}}"}</code></pre>
		<p>{@html $t('dg.help.ex3.subdesc')}</p>
		<pre><code>{"-- 父表脚本：造 10 个分类\nfor i = 1, 10 do\n  insert('categories', { name = '分类_' .. i })\nend\n\n-- 子表脚本：用 lastId() 获取父表最后一个自增 ID\nlocal lastCatId = lastId()\nfor i = 1, 100 do\n  insert('products', {\n    category_id = random_int(lastCatId - 9, lastCatId),\n    name = '商品_' .. i,\n    price = random_int(10, 99999) / 100.0\n  })\nend"}</code></pre>

		<h4>{$t('dg.help.ex4.title')}</h4>
		<p>{@html $t('dg.help.ex4.desc')}</p>
		<pre><code>{"for i = 1, 500 do\n  insert('users', {\n    username = 'user_' .. i,\n    email = random_email(),\n    password_hash = random_string(32)\n  })\n\n  local uid = lastId()\n\n  insert('user_profiles', {\n    user_id = uid,\n    nickname = random_name(),\n    avatar = 'https://avatar.example.com/' .. random_string(8) .. '.png',\n    bio = random_string(100),\n    birthday = random_date('1970-01-01', '2005-12-31')\n  })\nend"}</code></pre>

		<h4>{$t('dg.help.ex5.title')}</h4>
		<p>{@html $t('dg.help.ex5.desc')}</p>
		<pre class="dg-json"><code>{"{\"payload\":{\"luaVersion\":\"5.4\",\"tables\":[\n  {\"script\":\"for i = 1, 50 do\\n  insert('users', {\\n    username = 'buyer_' .. i,\\n    email = random_email(),\\n    phone = random_phone(),\\n    balance = random_int(0, 1000000) / 100.0\\n  })\\nend\"},\n  {\"script\":\"for i = 1, 200 do\\n  local userId = random_int(1, 50)\\n  insert('orders', {\\n    user_id = userId,\\n    order_no = 'ORD-' .. random_string(12),\\n    total_amount = random_int(100, 500000) / 100.0,\\n    status = random_enum('pending', 'paid', 'shipped', 'completed', 'cancelled'),\\n    created_at = random_date('2024-01-01', '2025-06-01')\\n  })\\nend\"},\n  {\"script\":\"for i = 1, 500 do\\n  insert('order_items', {\\n    order_id = random_int(1, 200),\\n    product_id = random_int(1, 100),\\n    quantity = random_int(1, 10),\\n    unit_price = random_int(100, 99999) / 100.0\\n  })\\nend\"}\n]}}"}</code></pre>

		<h4>{$t('dg.help.ex6.title')}</h4>
		<p>{@html $t('dg.help.ex6.desc')}</p>
		<pre><code>{"local statuses = {'pending', 'paid', 'shipped', 'completed', 'cancelled'}\nlocal weights = {10, 30, 25, 30, 5}  -- 权重分布\n\n-- 加权随机选择\nlocal function weighted_enum(values, weights)\n  local total = 0\n  for _, w in ipairs(weights) do total = total + w end\n  local r = random_int(1, total)\n  local acc = 0\n  for i, w in ipairs(weights) do\n    acc = acc + w\n    if r <= acc then return values[i] end\n  end\n  return values[#values]\nend\n\nfor i = 1, 1000 do\n  local amount = random_int(100, 999999) / 100.0\n\n  -- 大额订单更可能是 completed\n  local status\n  if amount > 5000 then\n    status = weighted_enum(statuses, {2, 20, 30, 45, 3})\n  else\n    status = weighted_enum(statuses, weights)\n  end\n\n  insert('orders', {\n    user_id = random_int(1, 50),\n    amount = amount,\n    discount = math.floor(amount * random_int(0, 30) / 100 * 100) / 100,\n    status = status,\n    remark = '订单 #' .. i .. ' - ' .. random_name() .. ' 的订单',\n    created_at = random_date('2024-01-01', '2025-06-01')\n  })\nend"}</code></pre>
	</div>
</Modal>

<style>
	.dg-help-content :global(h3) {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 1.25rem 0 0.5rem;
		color: var(--md-primary);
	}
	.dg-help-content :global(h3:first-child) {
		margin-top: 0;
	}
	.dg-help-content :global(h4) {
		font-size: 0.8125rem;
		font-weight: 600;
		margin: 1rem 0 0.375rem;
		color: var(--md-on-surface);
	}
	.dg-help-content :global(p) {
		font-size: 0.8125rem;
		line-height: 1.5;
		margin: 0.25rem 0 0.5rem;
		color: var(--md-on-surface-variant);
	}
	.dg-help-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.dg-help-content :global(th),
	.dg-help-content :global(td) {
		text-align: left;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--md-outline-variant);
		vertical-align: top;
	}
	.dg-help-content :global(th) {
		background: var(--md-surface-container);
		font-weight: 600;
		white-space: nowrap;
	}
	.dg-help-content :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		padding: 0.0625rem 0.25rem;
		border-radius: 3px;
		background: color-mix(in srgb, var(--md-primary) 8%, transparent);
		color: var(--md-primary);
	}
	.dg-help-content :global(pre) {
		margin: 0.25rem 0 0.75rem;
		padding: 0.75rem;
		border-radius: var(--md-radius-xs);
		background: var(--md-surface-container-lowest);
		border: 1px solid var(--md-outline-variant);
		overflow-x: auto;
	}
	.dg-help-content :global(pre code) {
		padding: 0;
		background: none;
		color: var(--md-on-surface);
		font-size: 0.75rem;
		white-space: pre;
	}
	.dg-help-content :global(pre.dg-json code) {
		color: var(--md-on-surface-variant);
		font-size: 0.6875rem;
	}
	.dg-note {
		font-size: 0.75rem;
		line-height: 1.5;
		padding: 0.5rem 0.75rem;
		margin: 0.5rem 0;
		border-radius: var(--md-radius-xs);
		background: color-mix(in srgb, var(--md-tertiary-container) 30%, transparent);
		border-left: 3px solid var(--md-tertiary);
		color: var(--md-on-tertiary-container);
	}
	.dg-note :global(code) {
		font-size: 0.6875rem;
	}
</style>
