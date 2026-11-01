// 그로우로그 웹 앱을 앱 안에 넣어 WKWebView로 여는 아이폰 앱.
// 기록은 웹의 localStorage에 있고, OS가 지워도 되살릴 수 있게 같은 내용을 Documents에 파일로도 남긴다.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

/// 앱 안의 www 폴더를 growlog://app/ 주소로 내준다. file:// 로 열면 웹뷰가 ES 모듈을 막는다.
final class WebAppFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "growlog"
    static let start = URL(string: "\(scheme)://app/index.html")!

    private let root = Bundle.main.bundleURL.appendingPathComponent("www", isDirectory: true).standardizedFileURL
    private let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "png": "image/png", "webmanifest": "application/manifest+json"]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        let type = types[file.pathExtension]
        guard file.path.hasPrefix(root.path + "/"), let type, let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            return task.didFinish()
        }
        let headers = ["Content-Type": type, "Content-Length": String(data.count)]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// 기록의 사본. Documents에 있어 파일 앱과 기기 백업에서도 보인다.
final class RecordFile {
    private let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("growlog.json")
    private let queue = DispatchQueue(label: "growlog.records")

    func save(_ json: String) {
        queue.async { [url] in try? Data(json.utf8).write(to: url, options: .atomic) }
    }

    /// 페이지보다 먼저 돌며, 웹 저장소가 비어 있을 때만 사본을 넣는다
    func restoreScript() -> WKUserScript? {
        let saved = queue.sync { [url] in try? String(contentsOf: url, encoding: .utf8) } // 기다리던 저장이 끝난 뒤에 읽는다
        guard let json = saved,
              let quoted = try? JSONSerialization.data(withJSONObject: [json]),
              let literal = String(data: quoted, encoding: .utf8) else { return nil }
        let source = "if (localStorage.getItem('growlog:v1') === null) localStorage.setItem('growlog:v1', \(literal)[0]);"
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
}

final class WebViewController: UIViewController {
    private let records = RecordFile()
    private var webView: WKWebView!
    private var themeWatch: NSKeyValueObservation?
    private var lightPage = false

    override var preferredStatusBarStyle: UIStatusBarStyle { lightPage ? .darkContent : .lightContent }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAppFiles(), forURLScheme: WebAppFiles.scheme)
        configuration.userContentController.add(self, name: "growlog")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never // 안전 영역은 페이지의 CSS가 직접 맞춘다
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.backgroundColor = webView.backgroundColor
        #if DEBUG
        webView.isInspectable = true
        #endif

        view = UIView()
        view.backgroundColor = webView.backgroundColor
        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.keyboardLayoutGuide.usesBottomSafeArea = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // 키보드 위까지만 쓴다. 키보드를 덮으면 웹뷰가 페이지를 밀어 올려 머리글이 상태 표시줄과 겹친다
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
        ])

        // 페이지가 테마에 맞춰 바꾸는 theme-color를 따라 상태 표시줄 글자색을 정한다
        themeWatch = webView.observe(\.themeColor) { [weak self] webView, _ in
            var white: CGFloat = 0
            guard webView.themeColor?.getWhite(&white, alpha: nil) == true else { return } // 웹 프로세스가 끝나면 잠시 비어 있다
            self?.lightPage = white > 0.5
            self?.setNeedsStatusBarAppearanceUpdate()
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        prepareRestore()
        webView.load(URLRequest(url: WebAppFiles.start))
    }

    private func prepareRestore() {
        let scripts = webView.configuration.userContentController
        scripts.removeAllUserScripts()
        if let restore = records.restoreScript() { scripts.addUserScript(restore) }
    }

    private func share(name: String, text: String) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent((name as NSString).lastPathComponent)
        guard (try? Data(text.utf8).write(to: file, options: .atomic)) != nil else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        present(sheet, animated: true)
    }
}

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let json = body["save"] as? String { records.save(json) }
        if let awake = body["keepAwake"] as? Bool { UIApplication.shared.isIdleTimerDisabled = awake }
        // 키보드와 시간 선택창도 고른 테마를 따른다. 페이지 색에서 정하면 '기기 설정'이 시스템 모양을 읽지 못한다.
        if let theme = body["theme"] as? String {
            view.window?.overrideUserInterfaceStyle = theme == "light" ? .light : theme == "dark" ? .dark : .unspecified
        }
        if body["buzz"] != nil { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        if let file = body["share"] as? [String: String], let name = file["name"], let text = file["text"] { share(name: name, text: text) }
    }
}

extension WebViewController: WKNavigationDelegate, WKUIDelegate {
    // 전화 걸기와 바깥 링크는 웹뷰가 스스로 열지 못해 시스템에 맡긴다
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, ![WebAppFiles.scheme, "about", "blob"].contains(url.scheme) else { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // target="_blank" 링크
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // 오래 쉬는 동안 OS가 웹 프로세스를 끝내면 빈 화면이 남는다
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        prepareRestore()
        webView.reload()
    }
}
