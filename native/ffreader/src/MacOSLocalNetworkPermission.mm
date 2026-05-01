#include <Network/Network.h>
#include <dispatch/dispatch.h>

// Triggers the macOS Local Network Privacy permission dialog on first launch.
// Raw POSIX sockets (used by multicast code) do NOT trigger the dialog.
// NWBrowser (Network.framework) DOES trigger it.
extern "C" void triggerMacOSLocalNetworkPermission() {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    dispatch_queue_t queue = dispatch_queue_create(
        "net.entazza.localnetwork.trigger", DISPATCH_QUEUE_SERIAL);
    nw_browse_descriptor_t desc =
        nw_browse_descriptor_create_bonjour_service("_crewtimer._udp", "local");
    nw_browser_t browser = nw_browser_create(desc, NULL);
    nw_release(desc);
    nw_browser_set_queue(browser, queue);
    nw_browser_start(browser);
    // Cancel after 2 s — just long enough to trigger the dialog
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), queue, ^{
      nw_browser_cancel(browser);
      nw_release(browser);
    });
  });
}
