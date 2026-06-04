<script>
	import { goto } from '$app/navigation';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';

	function goBack() {
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back();
		} else {
			goto('/');
		}
	}
</script>

<SettingsPanel onClose={goBack} />
